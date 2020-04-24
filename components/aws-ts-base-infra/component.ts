import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { Output } from "@pulumi/pulumi";
import * as config from "./config";
import * as utils from "./utils";

// Network is a properly configured Amazon network that leverages a Virtual Private Cloud (VPC) and
// the following features:
//
// * *Multi-AZ*. Use up to all of the Availability Zones (AZs) in your chosen region for high availability and disaster
//   recovery. AZs are geographically distributed within a region and spaced for best insulation and stability in the
//   even of a natural disaster. Maximizing AZ usage helps to insulate your application from a data center outage.
//
// * *Separate subnets*. Public subnets are provisioned for external-facing resources and private subnets for internal
//   resourcs. For each AZ, this template will create one public and one private subnet by default.
//
// * *Additional security layers*. Network access control lists (ACLs) and firewalls are used to control inbound
//   and outbound traffic at the subnet level. This template provides an option to create a network ACL protected
//   subnet in each AZ, providing individual controls that you can use to customize a second layer of defense.
//
// * *Independent routing tables*. Each private subnet gets an independent routing table to control the flow of traffic
//   within and outside the VPC. All public subnets share a single routing table as they all share the same Internet
//   gateway as the sole route to communicate with the Internet.
//
// * *Highly available NAT gateways*. Using a NAT gateway instead of NAT instances offers advantages in terms of
//   deployment, availability, and maintenance.
//
// * *Spare capacity*. As your environment grows over time, this template supports adding additional subnets.
//
// This component is designed to work as-is, or if you'd like, instantiate it using a template and customize it.
export class Network extends pulumi.ComponentResource {
    public readonly vpc: aws.ec2.Vpc;
    public readonly dhcpOptions: aws.ec2.VpcDhcpOptions;
    public readonly dhcpOptionsAssociation: aws.ec2.VpcDhcpOptionsAssociation;
    public readonly internetGateway: aws.ec2.InternetGateway;
    public readonly publicSubnets: aws.ec2.Subnet[];
    public readonly privateSubnets?: aws.ec2.Subnet[] | undefined;
    public readonly protectedSubnets?: aws.ec2.Subnet[] | undefined;
    public readonly natEips?: pulumi.Output<string>[] | undefined;
    public readonly s3VpcEndpointId: aws.ec2.VpcEndpoint | undefined;

    constructor(name: string, args: NetworkArgs, opts?: pulumi.ComponentResourceOptions) {
        super("pulumi-blueprints:network:Network", name, args, opts);

        // Fetch the region, as some of the below depends on it.
        const region = utils.getCurrentRegion(opts);

        // Create the VPC itself.
        this.vpc = new aws.ec2.Vpc("VPC", {
            cidrBlock: args.vpcCidr || "10.0.0.0/16",
            instanceTenancy: args.vpcTenancy || "default",
            enableDnsSupport: true,
            enableDnsHostnames: true,
            tags: { "Name": name },
        });

        // Associate DHCP options with our VPC.
        this.dhcpOptions = new aws.ec2.VpcDhcpOptions("DHCPOptions", {
            domainName: region == "us-east-1" ? "ec2.internal" : `${region}.compute.internal`,
            domainNameServers: [ "AmazonProvidedDNS" ],
        });
        this.dhcpOptionsAssociation = new aws.ec2.VpcDhcpOptionsAssociation("VPCDHCPOptionsAssociation", {
            vpcId: this.vpc.id,
            dhcpOptionsId: this.dhcpOptions.id,
        });

        // Create an Internet Gateway for our public subnet to connect to the Internet.
        this.internetGateway = new aws.ec2.InternetGateway("InternetGateway", {
            vpcId: this.vpc.id,
            tags: { "Name": name },
        });

        // Creat a Route Table for public subnets to use the Internet Gateway for 0.0.0.0/0 traffic.
        const publicSubnetRouteTable = new aws.ec2.RouteTable("PublicSubnetRouteTable", {
            vpcId: this.vpc.id,
            tags: {
                "Name": "Public Subnets",
                "Network": "Public",
            },
        });
        const publicSubnetRoute = new aws.ec2.Route("PublicSubnetRoute", {
            routeTableId: publicSubnetRouteTable.id,
            destinationCidrBlock: "0.0.0.0/0",
            gatewayId: this.internetGateway.id,
        });

        // For each AZ, create the NAT Gateways and public and private subnets. Keep track of various properties
        // so that they can be exported as top-level stack exports later on.
        this.publicSubnets = [];
        this.privateSubnets = args.createPrivateSubnets ? [] : undefined;
        this.protectedSubnets = args.createProtectedSubnets ? [] : undefined;
        this.natEips = args.createPrivateSubnets ? [] : undefined;
        const privateSubnetRouteTableIds: pulumi.Output<string>[] = [];
        for (let i = 0; i < args.availabilityZones.length; i++) {
            const az = args.availabilityZones[i];

            // Each AZ gets a public subnet.
            const publicSubnet = new aws.ec2.Subnet(`PublicSubnet${i}`, {
                vpcId: this.vpc.id,
                availabilityZone: az,
                cidrBlock: args.publicSubnetCidrs[i],
                mapPublicIpOnLaunch: true,
                tags: Object.assign({ "Name": `Public subnet ${az}` }, args.publicSubnetTags[i]),
            });
            this.publicSubnets.push(publicSubnet);

            new aws.ec2.RouteTableAssociation(`PublicSubnet${i}RouteTableAssociation`, {
                subnetId: publicSubnet.id,
                routeTableId: publicSubnetRouteTable.id,
            });

            // If desired, create a NAT Gateway and private subnet for each AZ.
            if (args.createPrivateSubnets) {
                const natEip = new aws.ec2.Eip(`NAT${i}EIP`, { vpc: true }, { dependsOn: this.internetGateway });
                const natGateway = new aws.ec2.NatGateway(`NATGateway${i}`, {
                    subnetId: publicSubnet.id,
                    allocationId: natEip.id,
                });
                this.natEips!.push(natEip.publicIp);

                const privateSubnet = new aws.ec2.Subnet(`PrivateSubnet${i}A`, {
                    vpcId: this.vpc.id,
                    availabilityZone: az,
                    cidrBlock: this.privateSubnetCidrs![i],
                    tags: Object.assign({ "Name": `Private subnet ${i}A` }, args.privateSubnetTags![i]),
                });
                this.privateSubnets!.push(privateSubnet);

                const privateSubnetRouteTable = new aws.ec2.RouteTable(`PrivateSubnet${i}ARouteTable`, {
                    vpcId: this.vpc.id,
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
                new aws.ec2.RouteTableAssociation(`PrivateSubnet${i}ARouteTableAssociation`, {
                    subnetId: privateSubnet.id,
                    routeTableId: privateSubnetRouteTable.id,
                });

                // Remember the route table ID for the VPC endpoint later.
                privateSubnetRouteTableIds.push(privateSubnetRouteTable.id);

                // If desired, create additional private subnets with dedicated network ACLs for extra protection.
                if (args.createProtectedSubnets) {
                    const protectedSubnet = new aws.ec2.Subnet(`PrivateSubnet${i}B`, {
                        vpcId: this.vpc.id,
                        availabilityZone: az,
                        cidrBlock: args.protectedSubnetCidrs![i],
                        tags: Object.assign({ "Name": `Private subnet ${i}B` }, args.protectedSubnetTags![i]),
                    });
                    this.protectedSubnets!.push(protectedSubnet);

                    const protectedSubnetRouteTable = new aws.ec2.RouteTable(`PrivateSubnet${i}BRouteTable`, {
                        vpcId: this.vpc.id,
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
                    new aws.ec2.RouteTableAssociation(`PrivateSubnet${i}BRouteTableAssociation`, {
                        subnetId: protectedSubnet.id,
                        routeTableId: protectedSubnetRouteTable.id,
                    });
                    const protectedSubnetNetworkAcl = new aws.ec2.NetworkAcl(`PrivateSubnet${i}BNetworkAcl`, {
                        vpcId: this.vpc.id,
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
        if (args.createPrivateSubnets) {
            this.s3VpcEndpointId = new aws.ec2.VpcEndpoint("S3VPCEndpoint", {
                vpcId: this.vpc.id,
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
            });
        }
    }

    public get publicSubnetIds(): pulumi.Output<string>[] {
        return this.publicSubnets.map(sub => sub.id);
    }

    public get publicSubnetCidrs(): pulumi.Output<string>[] {
        return this.publicSubnets.map(sub => sub.cidrBlock);
    }

    public get privateSubnetIds(): pulumi.Output<string>[] | undefined {
        return this.privateSubnets && this.privateSubnets.map(sub => sub.id);
    }

    public get privateSubnetCidrs(): pulumi.Output<string>[] | undefined {
        return this.privateSubnets && this.privateSubnets.map(sub => sub.cidrBlock);
    }

    public get protectedSubnetIds(): pulumi.Output<string>[] | undefined {
        return this.protectedSubnets && this.protectedSubnets.map(sub => sub.id);
    }

    public get protectedSubnetCidrs(): pulumi.Output<string>[] | undefined {
        return this.protectedSubnets && this.protectedSubnets.map(sub => sub.cidrBlock);
    }
}

export interface NetworkArgs {
    // List of AZs to use for the subnets in the VPC. Note: the logical order is preserved.
    availabilityZones: string[];
    // CIDR block for the VPC.
    vpcCidr: string;
    // The allowed tenancy of instances launched into the VPC.
    vpcTenancy: string;
    // Set to false to create only public subnets. If false, the CIDR parameters for ALL private subnets will be ignored.
    createPrivateSubnets: boolean;
    // Set to true to create a network ACL protected subnet in each AZ. If false, the CIDR parameters for those
    // subnets will be ignored. If true, it also requires that the `createPrivateSubnets` parameter is also true.
    createProtectedSubnets: boolean;
    // CIDR blocks for public subnets.
    publicSubnetCidrs: string[];
    // Tag to add to public subnets (an array of maps, one per AZ).
    publicSubnetTags: Record<string, string>[];
    // CIDR blocks for private subnets.
    privateSubnetCidrs?: string[];
    // Tag to add to private subnets (an array of maps, one per AZ).
    privateSubnetTags?: Record<string, string>[];
    // CIDR blocks for private NACL'd subnets.
    protectedSubnetCidrs?: string[];
    // Tag to add to private NACL'd subnets (an array of maps, one per AZ).
    protectedSubnetTags?: Record<string, string>[];
}

// createNetwork manufactures a new network option, substituting default arguments if needed.
export async function createNetwork(
        name: string, args?: Partial<NetworkArgs>, opts?: pulumi.ComponentResourceOptions): Promise<Network> {
    return new Network(name, await getNetworkArgsWithDefaults(args), opts);
}

// getNetworkArgsWithDefaults returns the default network settings. An optional subset of arguments can be
// supplied and any missing information will be populated and returned.
export async function getNetworkArgsWithDefaults(
        args?: Partial<NetworkArgs>, numberOfAvailabilityZones?: number): Promise<NetworkArgs> {
    args = args || {};

    // Default to the AZs in the current region plus standard VPC parameters.
    args.availabilityZones = args.availabilityZones ||
        await utils.getAvailabilityZones(numberOfAvailabilityZones || 2);
    args.vpcCidr = args.vpcCidr || "10.0.0.0/16";
    args.vpcTenancy = args.vpcTenancy || "default";
    args.createPrivateSubnets = (args.createPrivateSubnets !== false);
    args.createProtectedSubnets = (args.createProtectedSubnets === true);

    // We also use default CIDR blocks and tags depending on what has been enabled:
    const count = args.availabilityZones.length;
    //     - Public Subnets:
    args.publicSubnetCidrs = args.publicSubnetCidrs || await utils.getDefaultPublicSubnetCidrs(count);
    args.publicSubnetTags = args.publicSubnetTags || await utils.getDefaultPublicSubnetTags(count);
    //     - Private Subnets:
    if (args.createPrivateSubnets) {
        args.privateSubnetCidrs = args.privateSubnetCidrs || await utils.getDefaultPublicSubnetCidrs(count);
        args.privateSubnetTags = args.privateSubnetTags || await utils.getDefaultPublicSubnetTags(count);
    }
    //     - Protected Subnets:
    if (args.createProtectedSubnets) {
        args.privateSubnetCidrs = args.privateSubnetCidrs || await utils.getDefaultPublicSubnetCidrs(count);
        args.privateSubnetTags = args.privateSubnetTags || await utils.getDefaultPublicSubnetTags(count);
    }

    return args as NetworkArgs;
}
