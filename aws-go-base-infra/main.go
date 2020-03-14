package main

import (
	"fmt"

	awsconfig "github.com/pulumi/pulumi-aws/sdk/go/aws/config"
	"github.com/pulumi/pulumi-aws/sdk/go/aws/ec2"
	"github.com/pulumi/pulumi/sdk/go/pulumi"
)

func main() {
	pulumi.Run(func(ctx *pulumi.Context) error {
		// Parse the configuration.
		config := newProjectConfig(ctx)
		region := awsconfig.GetRegion(ctx)

		// Define the VPC.
		vpc, err := ec2.NewVpc(ctx, "VPC", &ec2.VpcArgs{
			CidrBlock:          pulumi.String(config.VpcCidr),
			InstanceTenancy:    pulumi.String(config.VpcTenancy),
			EnableDnsSupport:   pulumi.Bool(true),
			EnableDnsHostnames: pulumi.Bool(true),
			Tags:               pulumi.Map{"Name": pulumi.String(ctx.Project() + "-" + ctx.Stack())},
		})
		if err != nil {
			return err
		}

		// Associate DHCP options with our VPC.
		var domainName string
		if region == "us-east-1" {
			domainName = "ec2.internal"
		} else {
			domainName = region + ".compute.internal"
		}
		dhcpOptions, err := ec2.NewVpcDhcpOptions(ctx, "DHCPOptions", &ec2.VpcDhcpOptionsArgs{
			DomainName:        pulumi.String(domainName),
			DomainNameServers: pulumi.StringArray{pulumi.String("AmazonProvidedDNS")},
		})
		if err != nil {
			return err
		}
		_, err = ec2.NewVpcDhcpOptionsAssociation(ctx, "VPCDHCPOptionsAssociation", &ec2.VpcDhcpOptionsAssociationArgs{
			VpcId:         vpc.ID(),
			DhcpOptionsId: dhcpOptions.ID(),
		})
		if err != nil {
			return err
		}

		// Create an Internet Gateway for our public subnet to connect to the Internet.
		internetGateway, err := ec2.NewInternetGateway(ctx, "InternetGateway", &ec2.InternetGatewayArgs{
			VpcId: vpc.ID(),
			Tags:  pulumi.Map{"Name": pulumi.String(ctx.Project() + "-" + ctx.Stack())},
		})
		if err != nil {
			return err
		}

		// Creat a Route Table for public subnets to use the Internet Gateway for 0.0.0.0/0 traffic.
		publicSubnetRouteTable, err := ec2.NewRouteTable(ctx, "PublicSubnetRouteTable", &ec2.RouteTableArgs{
			VpcId: vpc.ID(),
			Tags: pulumi.Map{
				"Name":    pulumi.String("Public Subnets"),
				"Network": pulumi.String("Public"),
			},
		})
		if err != nil {
			return err
		}
		_, err = ec2.NewRoute(ctx, "PublicSubnetRoute", &ec2.RouteArgs{
			RouteTableId:         publicSubnetRouteTable.ID(),
			DestinationCidrBlock: pulumi.String("0.0.0.0/0"),
			GatewayId:            internetGateway.ID(),
		})
		if err != nil {
			return err
		}

		// For each AZ, create the NAT Gateways and public and private subnets. Keep track of various properties
		// so that they can be exported as top-level stack exports later on.
		var natEips []pulumi.StringOutput
		var publicSubnetIds []pulumi.IDOutput
		var privateSubnetIds []pulumi.IDOutput
		var protectedSubnetIds []pulumi.IDOutput
		var privateSubnetRouteTableIds []pulumi.IDOutput
		publicSubnetCidrs := config.GetPublicSubnetCidrs()
		publicSubnetTags := config.GetPublicSubnetTags()
		privateSubnetCidrs := config.GetPrivateSubnetCidrs()
		privateSubnetTags := config.GetPrivateSubnetTags()
		protectedSubnetCidrs := config.GetProtectedSubnetCidrs()
		protectedSubnetTags := config.GetProtectedSubnetTags()

		for i, az := range config.GetAvailabilityZones() {
			// Each AZ gets a public subnet.
			publicSubnetI := fmt.Sprintf("PublicSubnet%d", i)
			publicSubnetTags[i]["Name"] = fmt.Sprintf("Public subnet %d", i)
			publicSubnet, err := ec2.NewSubnet(ctx, publicSubnetI, &ec2.SubnetArgs{
				VpcId:               vpc.ID(),
				AvailabilityZone:    pulumi.String(az),
				CidrBlock:           pulumi.String(publicSubnetCidrs[i]),
				MapPublicIpOnLaunch: pulumi.Bool(true),
				Tags:                goMapToPulumiMap(publicSubnetTags[i]),
			})
			if err != nil {
				return err
			}
			publicSubnetIds = append(publicSubnetIds, publicSubnet.ID())

			_, err = ec2.NewRouteTableAssociation(ctx, publicSubnetI+"RouteTableAssociation", &ec2.RouteTableAssociationArgs{
				SubnetId:     publicSubnet.ID(),
				RouteTableId: publicSubnetRouteTable.ID(),
			})
			if err != nil {
				return err
			}

			// If desired, create a NAT Gateway and private subnet for each AZ.
			if config.CreatePrivateSubnets {
				natEip, err := ec2.NewEip(ctx, fmt.Sprintf("NAT%dEIP", i), &ec2.EipArgs{
					Vpc: pulumi.Bool(true),
				}, pulumi.DependsOn([]pulumi.Resource{internetGateway}))
				if err != nil {
					return err
				}
				natGateway, err := ec2.NewNatGateway(ctx, fmt.Sprintf("NATGateway%d", i), &ec2.NatGatewayArgs{
					SubnetId:     publicSubnet.ID(),
					AllocationId: natEip.ID(),
				})
				if err != nil {
					return err
				}
				natEips = append(natEips, natEip.PublicIp)

				privateSubnetI := fmt.Sprintf("PrivateSubnet%dA", i)
				privateSubnetTags[i]["Name"] = fmt.Sprintf("Private subnet %dA", i)
				privateSubnet, err := ec2.NewSubnet(ctx, privateSubnetI, &ec2.SubnetArgs{
					VpcId:            vpc.ID(),
					AvailabilityZone: pulumi.String(az),
					CidrBlock:        pulumi.String(privateSubnetCidrs[i]),
					Tags:             goMapToPulumiMap(privateSubnetTags[i]),
				})
				if err != nil {
					return err
				}
				privateSubnetIds = append(privateSubnetIds, privateSubnet.ID())

				privateSubnetRouteTable, err := ec2.NewRouteTable(ctx, privateSubnetI+"RouteTable", &ec2.RouteTableArgs{
					VpcId: vpc.ID(),
					Tags: pulumi.Map{
						"Name":    pulumi.String(fmt.Sprintf("Private subnet %dA", i)),
						"Network": pulumi.String("Private"),
					},
				})
				if err != nil {
					return err
				}
				_, err = ec2.NewRoute(ctx, privateSubnetI+"Route", &ec2.RouteArgs{
					RouteTableId:         privateSubnetRouteTable.ID(),
					DestinationCidrBlock: pulumi.String("0.0.0.0/0"),
					NatGatewayId:         natGateway.ID(),
				})
				if err != nil {
					return err
				}
				_, err = ec2.NewRouteTableAssociation(ctx, privateSubnetI+"RouteTableAssociation", &ec2.RouteTableAssociationArgs{
					SubnetId:     privateSubnet.ID(),
					RouteTableId: privateSubnetRouteTable.ID(),
				})
				if err != nil {
					return err
				}

				// Remember the route table ID for the VPC endpoint later.
				privateSubnetRouteTableIds = append(privateSubnetRouteTableIds, privateSubnetRouteTable.ID())

				// If desired, create additional private subnets with dedicated network ACLs for extra protection.
				if config.CreateProtectedSubnets {
					protectedSubnetI := fmt.Sprintf("PrivateSubnet%dB", i)
					protectedSubnetTags[i]["Name"] = fmt.Sprintf("Private subnet %dB", i)
					protectedSubnet, err := ec2.NewSubnet(ctx, protectedSubnetI, &ec2.SubnetArgs{
						VpcId:            vpc.ID(),
						AvailabilityZone: pulumi.String(az),
						CidrBlock:        pulumi.String(protectedSubnetCidrs[i]),
						Tags:             goMapToPulumiMap(protectedSubnetTags[i]),
					})
					if err != nil {
						return err
					}
					protectedSubnetIds = append(protectedSubnetIds, protectedSubnet.ID())

					protectedSubnetRouteTable, err := ec2.NewRouteTable(ctx, protectedSubnetI+"RouteTable", &ec2.RouteTableArgs{
						VpcId: vpc.ID(),
						Tags: pulumi.Map{
							"Name":    pulumi.String(fmt.Sprintf("Private subnet %dB", i)),
							"Network": pulumi.String("Private"),
						},
					})
					if err != nil {
						return err
					}
					_, err = ec2.NewRoute(ctx, protectedSubnetI+"Route", &ec2.RouteArgs{
						RouteTableId:         protectedSubnetRouteTable.ID(),
						DestinationCidrBlock: pulumi.String("0.0.0.0/0"),
						NatGatewayId:         natGateway.ID(),
					})
					if err != nil {
						return err
					}
					_, err = ec2.NewRouteTableAssociation(ctx, protectedSubnetI+"RouteTableAssociation", &ec2.RouteTableAssociationArgs{
						SubnetId:     protectedSubnet.ID(),
						RouteTableId: protectedSubnetRouteTable.ID(),
					})
					if err != nil {
						return err
					}
					protectedSubnetNetworkAcl, err := ec2.NewNetworkAcl(ctx, protectedSubnetI+"NetworkAcl", &ec2.NetworkAclArgs{
						VpcId:     vpc.ID(),
						SubnetIds: pulumi.StringArray{protectedSubnet.ID()},
						Tags: pulumi.Map{
							"Name":    pulumi.String(fmt.Sprintf("NACL protected subnet %d", i)),
							"Network": pulumi.String("NACL Protected"),
						},
					})
					if err != nil {
						return err
					}
					_, err = ec2.NewNetworkAclRule(ctx, protectedSubnetI+"NetworkAclEntryInbound", &ec2.NetworkAclRuleArgs{
						NetworkAclId: protectedSubnetNetworkAcl.ID(),
						CidrBlock:    pulumi.String("0.0.0.0/0"),
						Egress:       pulumi.Bool(false),
						Protocol:     pulumi.String("-1"),
						RuleAction:   pulumi.String("allow"),
						RuleNumber:   pulumi.Int(100),
					})
					if err != nil {
						return err
					}
					_, err = ec2.NewNetworkAclRule(ctx, protectedSubnetI+"NetworkAclEntryOutbound", &ec2.NetworkAclRuleArgs{
						NetworkAclId: protectedSubnetNetworkAcl.ID(),
						CidrBlock:    pulumi.String("0.0.0.0/0"),
						Egress:       pulumi.Bool(true),
						Protocol:     pulumi.String("-1"),
						RuleAction:   pulumi.String("allow"),
						RuleNumber:   pulumi.Int(100),
					})
					if err != nil {
						return err
					}

					// Remember the route table ID for the VPC endpoint later.
					privateSubnetRouteTableIds = append(privateSubnetRouteTableIds, protectedSubnetRouteTable.ID())
				}
			}
		}

		// If we created private subnets, allocate an S3 VPC Endpoint to simplify access to S3.
		var s3VpcEndpointId pulumi.IDOutput
		if config.CreatePrivateSubnets {
			s3VpcPolicy := `{
	"Version": "2012-10-17",
	"Statement": [{
		"Action": "*",
		"Effect": "Allow",
		"Resource": "*",
		"Principal": "*"
	}]
}
`
			s3VpcEndpoint, err := ec2.NewVpcEndpoint(ctx, "S3VPCEndpoint", &ec2.VpcEndpointArgs{
				VpcId:         vpc.ID(),
				Policy:        pulumi.String(s3VpcPolicy),
				RouteTableIds: idOutputArrayToStringOutputArray(privateSubnetRouteTableIds),
				ServiceName:   pulumi.String(fmt.Sprintf("com.amazonaws.%s.s3", region)),
			})
			if err != nil {
				return err
			}
			s3VpcEndpointId = s3VpcEndpoint.ID()
		}

		// Export all of the resulting properties that upstream stacks may want to consume.
		ctx.Export("vpcId", vpc.ID())
		ctx.Export("vpcCidr", vpc.CidrBlock)
		ctx.Export("natEips", stringOutputArrayToStringArrayOutput(natEips))
		ctx.Export("publicSubnetIds", idOutputArrayToIDArrayOutput(publicSubnetIds))
		ctx.Export("publicSubnetCidrs", goStringArrayToPulumiStringArray(publicSubnetCidrs))
		ctx.Export("publicSubnetRouteTableId", publicSubnetRouteTable.ID())
		ctx.Export("privateSubnetIds", idOutputArrayToIDArrayOutput(privateSubnetIds))
		ctx.Export("privateSubnetCidrs", goStringArrayToPulumiStringArray(privateSubnetCidrs))
		ctx.Export("protectedSubnetIds", idOutputArrayToIDArrayOutput(protectedSubnetIds))
		ctx.Export("protectedSubnetCidrs", goStringArrayToPulumiStringArray(protectedSubnetCidrs))
		ctx.Export("privateSubnetRouteTableIds", idOutputArrayToIDArrayOutput(privateSubnetRouteTableIds))
		ctx.Export("s3VpcEndpointId", s3VpcEndpointId)

		return nil
	})
}
