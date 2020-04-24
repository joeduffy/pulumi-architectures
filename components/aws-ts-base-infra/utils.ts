import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

// isPulumiMain returns true if we're running this as a program, rather than a library.
export function isPulumiMain(m: any): boolean {
    // TODO: would be better if Pulumi's RT library told us this.
    return (!m.parent || m.parent.id.endsWith("@pulumi/pulumi/cmd/run/run.js"));
}

// getCurrentRegion returns the current AWS region, optionally using component resource options for the lookup.
export function getCurrentRegion(opts?: pulumi.ComponentResourceOptions) {
    /** TODO: how to do this?
    if (opts && opts.providers) {
        const prov = opts.providers["aws"];
        if (prov) {
            return (prov as aws.Provider).region;
        }
    }
    */
    return aws.config.requireRegion();
}

// getAvailabilityZones returns the list of AZs this stack should use, based on configuration parameters. If
// "availabilityZones" is set, those exact zones are returned; else if "numberOfAzs" is set, the first AZs up
// to that count are returned; otherwise, all AZs in the current region are returned.
export async function getAvailabilityZones(count?: number): Promise<string[]> {
    const currentRegionZones = await aws.getAvailabilityZones().names;
    if (count) {
        return currentRegionZones.slice(0, count);
    }
    return currentRegionZones;
}

// getDefaultPublicSubnetCidrs returns a list of CIDR blocks to use for public subnets, one per AZ.
export async function getDefaultPublicSubnetCidrs(count?: number): Promise<string[]> {
    const azs = await getAvailabilityZones(count);
    return [ "10.0.128.0/20", "10.0.144.0/20", "10.0.160.0/20", "10.0.176.0/20" ].slice(0, azs.length);
}

// getDefaultPublicSubnetTags returns a list of tag maps to be used for public subnets, one per AZ.
export async function getDefaultPublicSubnetTags(count?: number): Promise<Record<string, string>[]> {
    const azs = await getAvailabilityZones(count);
    return Array(azs.length).fill({ "Network": "Public" });
}

// getDefaultPrivateSubnetCidrs returns a list of CIDR blocks to use for private subnets, one per AZ.
export async function getDefaultPrivateSubnetCidrs(count?: number): Promise<string[] | undefined> {
    const azs = await getAvailabilityZones(count);
    return [ "10.0.0.0/19", "10.0.32.0/19", "10.0.64.0/19", "10.0.96.0/19" ].slice(0, azs.length);
}

// getDefaultPrivateSubnetTags returns a list of tag maps to be used for private subnets, one per AZ.
export async function getDefaultPrivateSubnetTags(count?: number): Promise<Record<string, string>[] | undefined> {
    const azs = await getAvailabilityZones(count);
    return Array(azs.length).fill({ "Network": "Private" });
}


// getDefaultProtectedSubnetCidrs returns a list of CIDR blocks to use for NACL'd private subnets, one per AZ.
export async function getDefaultProtectedSubnetCidrs(count?: number): Promise<string[] | undefined> {
    const azs = await getAvailabilityZones(count);
    return [ "10.0.192.0/21", "10.0.200.0/21", "10.0.208.0/21", "10.0.216.0/21" ].slice(0, azs.length);
}

// getDefaultProtectedSubnetTags returns a list of tag maps to be used for NACL'd private subnets, one per AZ.
export async function getDefaultProtectedSubnetTags(count?: number): Promise<Record<string, string>[] | undefined> {
    const azs = await getAvailabilityZones(count);
    return Array(azs.length).fill({ "Network": "Private" });
}

