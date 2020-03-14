import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { Output } from "@pulumi/pulumi";
import * as config from "./config";

const region = aws.config.requireRegion();
const fullProjectStack = `${pulumi.getProject()}-${pulumi.getStack()}`;

async function main() {
    const azs = await config.getAvailabilityZones();

    const vpc = new aws.ec2.Vpc("VPC", {
        cidrBlock: config.params.vpcCidr,
        instanceTenancy: config.params.vpcTenancy,
        enableDnsSupport: true,
        enableDnsHostnames: true,
        tags: { "Name": fullProjectStack },
    });

    // Associate DHCP options with our VPC.
    const dhcpOptions = new aws.ec2.VpcDhcpOptions("DHCPOptions", {
        domainName: region == "us-east-1" ? "ec2.internal" : `${region}.compute.internal`,
        domainNameServers: [ "AmazonProvidedDNS" ],
    });
    const vpcDhcpOptionsAssociation = new aws.ec2.VpcDhcpOptionsAssociation("VPCDHCPOptionsAssociation", {
        vpcId: vpc.id,
        dhcpOptionsId: dhcpOptions.id,
    });

    // Create an Internet Gateway for our public subnet to connect to the Internet.
    const internetGateway = new aws.ec2.InternetGateway("InternetGateway", {
        vpcId: vpc.id,
        tags: { "Name": fullProjectStack },
    });

    // Creat a Route Table for public subnets to use the Internet Gateway for 0.0.0.0/0 traffic.
    const publicSubnetRouteTable = new aws.ec2.RouteTable("PublicSubnetRouteTable", {
        vpcId: vpc.id,
        tags: {
            "Name": "Public Subnets",
            "Network": "Public",
        },
    });
    const publicSubnetRoute = new aws.ec2.Route("PublicSubnetRoute", {
        routeTableId: publicSubnetRouteTable.id,
        destinationCidrBlock: "0.0.0.0/0",
        gatewayId: internetGateway.id,
    });

    // For each AZ, create the NAT Gateways and public and private subnets. Keep track of various properties
    // so that they can be exported as top-level stack exports later on.
    const natEips: Output<string>[] = [];
    const publicSubnetIds: Output<string>[] = [];
    const publicSubnetCidrs = await config.getPublicSubnetCidrs();
    const publicSubnetTags = await config.getPublicSubnetTags();
    const privateSubnetIds: Output<string>[] = [];
    const privateSubnetCidrs = await config.getPrivateSubnetCidrs();
    const privateSubnetTags = await config.getPrivateSubnetTags();
    const protectedSubnetIds: Output<string>[] = [];
    const protectedSubnetCidrs = await config.getProtectedSubnetCidrs();
    const protectedSubnetTags = await config.getProtectedSubnetTags();
    const privateSubnetRouteTableIds: Output<string>[] = [];
    for (let i = 0; i < azs.length; i++) {
        const az = azs[i];

        // Each AZ gets a public subnet.
        const publicSubnet = new aws.ec2.Subnet(`PublicSubnet${i}`, {
            vpcId: vpc.id,
            availabilityZone: az,
            cidrBlock: publicSubnetCidrs[i],
            mapPublicIpOnLaunch: true,
            tags: Object.assign({
                "Name": `Public subnet ${az}`,
            }, publicSubnetTags[i]),
        });
        publicSubnetIds.push(publicSubnet.id);

        const publicSubnetRouteTableAssociation = new aws.ec2.RouteTableAssociation(`PublicSubnet${i}RouteTableAssociation`, {
            subnetId: publicSubnet.id,
            routeTableId: publicSubnetRouteTable.id,
        });

        // If desired, create a NAT Gateway and private subnet for each AZ.
        if (config.params.createPrivateSubnets) {
            const natEip = new aws.ec2.Eip(`NAT${i}EIP`, { vpc: true }, { dependsOn: internetGateway });
            const natGateway = new aws.ec2.NatGateway(`NATGateway${i}`, {
                subnetId: publicSubnet.id,
                allocationId: natEip.id,
            });
            natEips.push(natEip.publicIp);

            const privateSubnet = new aws.ec2.Subnet(`PrivateSubnet${i}A`, {
                vpcId: vpc.id,
                availabilityZone: az,
                cidrBlock: privateSubnetCidrs[i],
                tags: Object.assign({
                    "Name": `Private subnet ${i}A`,
                }, privateSubnetTags[i]),
            });
            privateSubnetIds.push(privateSubnet.id);

            const privateSubnetRouteTable = new aws.ec2.RouteTable(`PrivateSubnet${i}ARouteTable`, {
                vpcId: vpc.id,
                tags: {
                    "Name": `Private subnet ${i}A`,
                    "Network": "Private",
                },
            });
            const privateSubnetRoute = new aws.ec2.Route(`PrivateSubnet${i}ARoute`, {
                routeTableId: privateSubnetRouteTable.id,
                destinationCidrBlock: "0.0.0.0/0",
                natGatewayId: natGateway.id,
            });
            const privateSubnetRouteTableAssociation = new aws.ec2.RouteTableAssociation(`PrivateSubnet${i}ARouteTableAssociation`, {
                subnetId: privateSubnet.id,
                routeTableId: privateSubnetRouteTable.id,
            });

            // Remember the route table ID for the VPC endpoint later.
            privateSubnetRouteTableIds.push(privateSubnetRouteTable.id);

            // If desired, create additional private subnets with dedicated network ACLs for extra protection.
            if (config.params.createProtectedSubnets) {
                const protectedSubnet = new aws.ec2.Subnet(`PrivateSubnet${i}B`, {
                    vpcId: vpc.id,
                    availabilityZone: az,
                    cidrBlock: protectedSubnetCidrs[i],
                    tags: Object.assign({
                        "Name": `Private subnet ${i}B`,
                    }, protectedSubnetTags[i]),
                });
                protectedSubnetIds.push(protectedSubnet.id);

                const protectedSubnetRouteTable = new aws.ec2.RouteTable(`PrivateSubnet${i}BRouteTable`, {
                    vpcId: vpc.id,
                    tags: {
                        "Name": `Private subnet ${i}B`,
                        "Network": "Private",
                    },
                });
                const protectedSubnetRoute = new aws.ec2.Route(`PrivateSubnet${i}BRoute`, {
                    routeTableId: protectedSubnetRouteTable.id,
                    destinationCidrBlock: "0.0.0.0/0",
                    natGatewayId: natGateway.id,
                });
                const protectedSubnetRouteTableAssociation = new aws.ec2.RouteTableAssociation(`PrivateSubnet${i}BRouteTableAssociation`, {
                    subnetId: protectedSubnet.id,
                    routeTableId: protectedSubnetRouteTable.id,
                });
                const protectedSubnetNetworkAcl = new aws.ec2.NetworkAcl(`PrivateSubnet${i}BNetworkAcl`, {
                    vpcId: vpc.id,
                    subnetIds: [ protectedSubnet.id ],
                    tags: {
                        "Name": `NACL protected subnet ${i}`,
                        "Network": "NACL Protected",
                    },
                });
                const protectedSubnetNetworkAclEntryInbound = new aws.ec2.NetworkAclRule(`PrivateSubnet${i}BNetworkAclEntryInbound`, {
                    networkAclId: protectedSubnetNetworkAcl.id,
                    cidrBlock: "0.0.0.0/0",
                    egress: false,
                    protocol: "-1",
                    ruleAction: "allow",
                    ruleNumber: 100,
                });
                const protectedSubnetNetworkAclEntryOutbound = new aws.ec2.NetworkAclRule(`PrivateSubnet${i}BNetworkAclEntryOutbound`, {
                    networkAclId: protectedSubnetNetworkAcl.id,
                    cidrBlock: "0.0.0.0/0",
                    egress: true,
                    protocol: "-1",
                    ruleAction: "allow",
                    ruleNumber: 100,
                });

                // Remember the route table ID for the VPC endpoint later.
                privateSubnetRouteTableIds.push(protectedSubnetRouteTable.id);
            }
        }
    }

    // If we created private subnets, allocate an S3 VPC Endpoint to simplify access to S3.
    let s3VpcEndpointId: Output<string> | undefined;
    if (config.params.createPrivateSubnets) {
        s3VpcEndpointId = new aws.ec2.VpcEndpoint("S3VPCEndpoint", {
            vpcId: vpc.id,
            policy: JSON.stringify({
                "Version": "2012-10-17",
                "Statement": [{
                    "Action": "*",
                    "Effect": "Allow",
                    "Resource": "*",
                    "Principal": "*",
                }],
            }),
            routeTableIds: privateSubnetRouteTableIds,
            serviceName: `com.amazonaws.${region}.s3`,
        }).id;
    }

    // Export all of the resulting properties that upstream stacks may want to consume.
    return {
        vpcId: vpc.id,
        vpcCidr: vpc.cidrBlock,
        natEips,
        publicSubnetIds,
        publicSubnetCidrs,
        publicSubnetRouteTableId: publicSubnetRouteTable.id,
        privateSubnetIds,
        privateSubnetCidrs,
        protectedSubnetIds,
        protectedSubnetCidrs,
        privateSubnetRouteTableIds,
        s3VpcEndpointId,
    };
}

module.exports = main;
