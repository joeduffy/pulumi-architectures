import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

// Read in the AZ and VPC configuration parameters and export them for easy consumption.
const config = new pulumi.Config();

export const params = {
    // List of AZs to use for the subnets in the VPC. Note: the logical order is preserved.
    availabilityZones: config.getObject<string[]>("availabilityZones"),
    // Number of AZs to use in the VPC. If both are specified, this must match your selections in the list of AZs parameter.
    numberOfAvailabilityZones: config.getNumber("numberOfAvailabilityZones"),
    // Set to false to create only public subnets. If false, the CIDR parameters for ALL private subnets will be ignored.
    createPrivateSubnets: config.getBoolean("createPrivateSubnets") === undefined ?
        true : config.getBoolean("createPrivateSubnets"),
    // Set to true to create a network ACL protected subnet in each AZ. If false, the CIDR parameters for those
    // subnets will be ignored. If true, it also requires that the `createPrivateSubnets` parameter is also true.
    createProtectedSubnets: config.getBoolean("createProtectedSubnets"),
    // CIDR block for the VPC.
    vpcCidr: config.get("vpcCidr") || "10.0.0.0/16",
    // The allowed tenancy of instances launched into the VPC.
    vpcTenancy: config.get("vpcTenancy") || "default",
    // CIDR blocks for public subnets.
    publicSubnetCidrs: config.getObject<string[]>("privateSubnetCidrs"),
    // Tag to add to public subnets (an array of maps, one per AZ).
    publicSubnetTags: config.getObject<Record<string, string>[]>("privateSubnetTags"),
    // CIDR blocks for private subnets.
    privateSubnetCidrs: config.getObject<string[]>("privateSubnetCidrs"),
    // Tag to add to private subnets (an array of maps, one per AZ).
    privateSubnetTags: config.getObject<Record<string, string>[]>("privateSubnetTags"),
    // CIDR blocks for private NACL'd subnets.
    protectedSubnetCidrs: config.getObject<string[]>("protectedSubnetCidrs"),
    // Tag to add to private NACL'd subnets (an array of maps, one per AZ).
    protectedSubnetTags: config.getObject<Record<string, string>[]>("protectedSubnetTags"),
};

// getAvailabilityZones returns the list of AZs this stack should use, based on configuration parameters. If
// "availabilityZones" is set, those exact zones are returned; else if "numberOfAzs" is set, the first AZs up
// to that count are returned; otherwise, all AZs in the current region are returned.
export async function getAvailabilityZones(): Promise<string[]> {
    if (params.availabilityZones) {
        return params.availabilityZones;
    }
    const currentRegionZones = await aws.getAvailabilityZones().names;
    if (params.numberOfAvailabilityZones) {
        return currentRegionZones.slice(0, params.numberOfAvailabilityZones);
    }
    return currentRegionZones;
}

// getPublicSubnetCidrs returns a list of CIDR blocks to use for public subnets, one per AZ.
export async function getPublicSubnetCidrs(): Promise<string[]> {
    if (params.publicSubnetCidrs) {
        return params.publicSubnetCidrs;
    }
    const azs = await getAvailabilityZones();
    return [ "10.0.128.0/20", "10.0.144.0/20", "10.0.160.0/20", "10.0.176.0/20" ].slice(0, azs.length);
}

// getPublicSubnetTags returns a list of tag maps to be used for public subnets, one per AZ.
export async function getPublicSubnetTags(): Promise<Record<string, string>[]> {
    if (params.publicSubnetTags) {
        return params.publicSubnetTags;
    }
    const azs = await getAvailabilityZones();
    return Array(azs.length).fill({ "Network": "Public" });
}

// getPrivateSubnetCidrs returns a list of CIDR blocks to use for private subnets, one per AZ.
export async function getPrivateSubnetCidrs(): Promise<string[] | undefined> {
    if (!params.createPrivateSubnets) {
        return undefined;
    } else if (params.privateSubnetCidrs) {
        return params.privateSubnetCidrs;
    }
    const azs = await getAvailabilityZones();
    return [ "10.0.0.0/19", "10.0.32.0/19", "10.0.64.0/19", "10.0.96.0/19" ].slice(0, azs.length);
}

// getPrivateSubnetTags returns a list of tag maps to be used for private subnets, one per AZ.
export async function getPrivateSubnetTags(): Promise<Record<string, string>[] | undefined> {
    if (!params.createPrivateSubnets) {
        return undefined;
    } else if (params.privateSubnetTags) {
        return params.privateSubnetTags;
    }
    const azs = await getAvailabilityZones();
    return Array(azs.length).fill({ "Network": "Private" });
}


// getProtectedSubnetCidrs returns a list of CIDR blocks to use for NACL'd private subnets, one per AZ.
export async function getProtectedSubnetCidrs(): Promise<string[] | undefined> {
    if (!params.createPrivateSubnets || !params.createProtectedSubnets) {
        return undefined;
    } else if (params.protectedSubnetCidrs) {
        return params.protectedSubnetCidrs;
    }
    const azs = await getAvailabilityZones();
    return [ "10.0.192.0/21", "10.0.200.0/21", "10.0.208.0/21", "10.0.216.0/21" ].slice(0, azs.length);
}

// getProtectedSubnetTags returns a list of tag maps to be used for NACL'd private subnets, one per AZ.
export async function getProtectedSubnetTags(): Promise<Record<string, string>[] | undefined> {
    if (!params.createPrivateSubnets || !params.createProtectedSubnets) {
        return undefined;
    } else if (params.protectedSubnetTags) {
        return params.protectedSubnetTags;
    }
    const azs = await getAvailabilityZones();
    return Array(azs.length).fill({ "Network": "Private" });
}
