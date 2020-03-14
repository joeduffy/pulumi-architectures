using Pulumi;
using Aws = Pulumi.Aws;
using Ec2 = Pulumi.Aws.Ec2;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.Threading.Tasks;

class Program
{
    static Task<int> Main() {
        return Deployment.RunAsync(async () => {
            var region = Aws.Config.Region;
            var fullProjectStack = $"{Deployment.Instance.ProjectName}-{Deployment.Instance.StackName}";

            // Create the VPC.
            var vpc = new Ec2.Vpc("VPC", new Ec2.VpcArgs {
                CidrBlock = Config.VpcCidr,
                InstanceTenancy = Config.VpcTenancy,
                EnableDnsSupport = true,
                EnableDnsHostnames = true,
                Tags = new Dictionary<string, object> { { "Name", fullProjectStack } },
            });

            // Associate DHCP options with our VPC.
            var dhcpOptions = new Ec2.VpcDhcpOptions("DHCPOptions", new Ec2.VpcDhcpOptionsArgs {
                DomainName = (region == "us-east-1" ? "ec2.internal" : $"{region}.compute.internal"),
                DomainNameServers = { "AmazonProvidedDNS" },
            });
            var vpcDhcpOptionsAssociation = new Ec2.VpcDhcpOptionsAssociation("VPCDHCPOptionsAssociation", new Ec2.VpcDhcpOptionsAssociationArgs {
                VpcId = vpc.Id,
                DhcpOptionsId = dhcpOptions.Id,
            });

            // Create an Internet Gateway for our public subnet to connect to the Internet.
            var internetGateway = new Ec2.InternetGateway("InternetGateway", new Ec2.InternetGatewayArgs {
                VpcId = vpc.Id,
                Tags = new Dictionary<string, object> { { "Name", fullProjectStack } },
            });

            // Creat a Route Table for public subnets to use the Internet Gateway for 0.0.0.0/0 traffic.
            var publicSubnetRouteTable = new Ec2.RouteTable("PublicSubnetRouteTable", new Ec2.RouteTableArgs {
                VpcId = vpc.Id,
                Tags = new Dictionary<string, object> {
                    { "Name", "Public Subnets" },
                    { "Network", "Public" },
                },
            });
            var publicSubnetRoute = new Ec2.Route("PublicSubnetRoute", new Ec2.RouteArgs {
                RouteTableId = publicSubnetRouteTable.Id,
                DestinationCidrBlock = "0.0.0.0/0",
                GatewayId = internetGateway.Id,
            });

            // For each AZ, create the NAT Gateways and public and private subnets. Keep track of various properties
            // so that they can be exported as top-level stack exports later on.
            var natEips = ImmutableArray.CreateBuilder<Output<string>>();
            var publicSubnetIds = ImmutableArray.CreateBuilder<Output<string>>();
            var privateSubnetIds = ImmutableArray.CreateBuilder<Output<string>>();
            var protectedSubnetIds = ImmutableArray.CreateBuilder<Output<string>>();
            var privateSubnetRouteTableIds = ImmutableArray.CreateBuilder<Output<string>>();
            var publicSubnetCidrs = await Config.GetPublicSubnetCidrs();
            var publicSubnetTags = await Config.GetPublicSubnetTags();
            var privateSubnetCidrs = await Config.GetPrivateSubnetCidrs();
            var privateSubnetTags = await Config.GetPrivateSubnetTags();
            var protectedSubnetCidrs = await Config.GetProtectedSubnetCidrs();
            var protectedSubnetTags = await Config.GetProtectedSubnetTags();

            var azs = await Config.GetAvailabilityZones();
            for (var i = 0; i < azs.Length; i++) {
                var az = azs[i];

                // Each AZ gets a public subnet.
                var publicSubnet = new Ec2.Subnet($"PublicSubnet{i}", new Ec2.SubnetArgs {
                    VpcId = vpc.Id,
                    AvailabilityZone = az,
                    CidrBlock = publicSubnetCidrs[i],
                    MapPublicIpOnLaunch = true,
                    Tags = publicSubnetTags[i].Add("Name", $"Public subnet {i}"),
                });
                publicSubnetIds.Add(publicSubnet.Id);

                var publicSubnetRouteTableAssociation = new Ec2.RouteTableAssociation($"PublicSubnet{i}RouteTableAssociation", new Ec2.RouteTableAssociationArgs {
                    SubnetId = publicSubnet.Id,
                    RouteTableId = publicSubnetRouteTable.Id,
                });

                // If desired, create a NAT Gateway and private subnet for each AZ.
                if (Config.CreatePrivateSubnets) {
                    var natEip = new Ec2.Eip($"NAT{i}EIP", new Ec2.EipArgs {
                        Vpc = true
                    }, new CustomResourceOptions { DependsOn = { internetGateway } });
                    var natGateway = new Ec2.NatGateway($"NATGateway{i}", new Ec2.NatGatewayArgs {
                        SubnetId = publicSubnet.Id,
                        AllocationId = natEip.Id,
                    });
                    natEips.Add(natEip.PublicIp);

                    var privateSubnet = new Ec2.Subnet($"PrivateSubnet{i}A", new Ec2.SubnetArgs {
                        VpcId = vpc.Id,
                        AvailabilityZone = az,
                        CidrBlock = privateSubnetCidrs[i],
                        Tags = privateSubnetTags[i].Add("Name", $"Private subnet {i}A"),
                    });
                    privateSubnetIds.Add(privateSubnet.Id);

                    var privateSubnetRouteTable = new Ec2.RouteTable($"PrivateSubnet{i}ARouteTable", new Ec2.RouteTableArgs {
                        VpcId = vpc.Id,
                        Tags = new Dictionary<string, object> {
                            { "Name", $"Private subnet {i}A" },
                            { "Network", "Private" },
                        },
                    });
                    var privateSubnetRoute = new Ec2.Route($"PrivateSubnet{i}ARoute", new Ec2.RouteArgs {
                        RouteTableId = privateSubnetRouteTable.Id,
                        DestinationCidrBlock = "0.0.0.0/0",
                        NatGatewayId = natGateway.Id,
                    });
                    var privateSubnetRouteTableAssociation = new Ec2.RouteTableAssociation($"PrivateSubnet{i}ARouteTableAssociation", new Ec2.RouteTableAssociationArgs {
                        SubnetId = privateSubnet.Id,
                        RouteTableId = privateSubnetRouteTable.Id,
                    });

                    // Remember the route table ID for the VPC endpoint later.
                    privateSubnetRouteTableIds.Add(privateSubnetRouteTable.Id);

                    // If desired, create additional private subnets with dedicated network ACLs for extra protection.
                    if (Config.CreateProtectedSubnets) {
                        var protectedSubnet = new Ec2.Subnet($"PrivateSubnet{i}B", new Ec2.SubnetArgs {
                            VpcId = vpc.Id,
                            AvailabilityZone = az,
                            CidrBlock = protectedSubnetCidrs[i],
                            Tags = protectedSubnetTags[i].Add("Name", $"Private subnet ${i}B"),
                        });
                        protectedSubnetIds.Add(protectedSubnet.Id);

                        var protectedSubnetRouteTable = new Ec2.RouteTable($"PrivateSubnet{i}BRouteTable", new Ec2.RouteTableArgs {
                            VpcId = vpc.Id,
                            Tags = new Dictionary<string, object> {
                                { "Name", $"Private subnet {i}B" },
                                { "Network", "Private" },
                            },
                        });
                        var protectedSubnetRoute = new Ec2.Route($"PrivateSubnet{i}BRoute", new Ec2.RouteArgs {
                            RouteTableId = protectedSubnetRouteTable.Id,
                            DestinationCidrBlock = "0.0.0.0/0",
                            NatGatewayId = natGateway.Id,
                        });
                        var protectedSubnetRouteTableAssociation = new Ec2.RouteTableAssociation($"PrivateSubnet{i}BRouteTableAssociation", new Ec2.RouteTableAssociationArgs {
                            SubnetId = protectedSubnet.Id,
                            RouteTableId = protectedSubnetRouteTable.Id,
                        });
                        var protectedSubnetNetworkAcl = new Ec2.NetworkAcl($"PrivateSubnet{i}BNetworkAcl", new Ec2.NetworkAclArgs {
                            VpcId = vpc.Id,
                            SubnetIds = { protectedSubnet.Id },
                            Tags = new Dictionary<string, object> {
                                { "Name", $"NACL protected subnet {i}" },
                                { "Network", "NACL Protected" },
                            },
                        });
                        var protectedSubnetNetworkAclEntryInbound = new Ec2.NetworkAclRule($"PrivateSubnet{i}BNetworkAclEntryInbound", new Ec2.NetworkAclRuleArgs {
                            NetworkAclId = protectedSubnetNetworkAcl.Id,
                            CidrBlock = "0.0.0.0/0",
                            Egress = false,
                            Protocol = "-1",
                            RuleAction = "allow",
                            RuleNumber = 100,
                        });
                        var protectedSubnetNetworkAclEntryOutbound = new Ec2.NetworkAclRule($"PrivateSubnet{i}BNetworkAclEntryOutbound", new Ec2.NetworkAclRuleArgs {
                            NetworkAclId = protectedSubnetNetworkAcl.Id,
                            CidrBlock = "0.0.0.0/0",
                            Egress = true,
                            Protocol = "-1",
                            RuleAction = "allow",
                            RuleNumber = 100,
                        });

                        // Remember the route table ID for the VPC endpoint later.
                        privateSubnetRouteTableIds.Add(protectedSubnetRouteTable.Id);
                    }
                }
            }

            // If we created private subnets, allocate an S3 VPC Endpoint to simplify access to S3.
            Output<string>? s3VpcEndpointId = null;
            if (Config.CreatePrivateSubnets) {
                s3VpcEndpointId = new Ec2.VpcEndpoint("S3VPCEndpoint", new Ec2.VpcEndpointArgs {
                    VpcId = vpc.Id,
                    Policy = @"{
    ""Version"": ""2012-10-17"",
    ""Statement"": [{
        ""Action"": ""*"",
        ""Effect"": ""Allow"",
        ""Resource"": ""*"",
        ""Principal"": ""*""
    }]
}
",
                    RouteTableIds = privateSubnetRouteTableIds.ToImmutable(),
                    ServiceName = $"com.amazonaws.{region}.s3",
                }).Id;
            }

           // Export all of the resulting properties that upstream stacks may want to consume.
           return new Dictionary<string, object?>
            {
                { "vpcId", vpc.Id },
                { "vpcCidr", vpc.CidrBlock },
                { "natEips", natEips.ToImmutableArray() },
                { "publicSubnetIds", publicSubnetIds.ToImmutableArray() },
                { "publicSubnetCidrs", publicSubnetCidrs },
                { "publicSubnetRouteTableId", publicSubnetRouteTable.Id },
                { "privateSubnetIds", privateSubnetIds.ToImmutableArray() },
                { "privateSubnetCidrs", privateSubnetCidrs },
                { "protectedSubnetIds", protectedSubnetIds.ToImmutableArray() },
                { "protectedSubnetCidrs", protectedSubnetCidrs },
                { "privateSubnetRouteTableIds", privateSubnetRouteTableIds.ToImmutableArray() },
                { "s3VpcEndpointId", s3VpcEndpointId },
            };
        });
    }
}
