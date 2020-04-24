import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { getNetworkArgsWithDefaults, NetworkArgs } from "./component";
import * as utils from "./utils";

// Read in the AZ and VPC configuration parameters and export them for easy consumption.
const config = new pulumi.Config();

// getNetworkArgs returns the full set of arguments from configuration, setting some defaults
// as necessary (like the AZs) to produce a fully populated arg bag for the network component.
export function getNetworkArgs(): Promise<NetworkArgs> {
    const args: Partial<NetworkArgs> = {
        availabilityZones: config.getObject<string[]>("availabilityZones"),
        vpcCidr: config.get("vpcCidr"),
        vpcTenancy: config.get("vpcTenancy"),
        createPrivateSubnets: config.getBoolean("createPrivateSubnets"),
        createProtectedSubnets: config.getBoolean("createProtectedSubnets"),
        publicSubnetCidrs: config.getObject<string[]>("publicSubnetCidrs"),
        publicSubnetTags: config.getObject<Record<string, string>[]>("publicSubnetTags"),
        privateSubnetCidrs: config.getObject<string[]>("privateSubnetCidrs"),
        privateSubnetTags: config.getObject<Record<string, string>[]>("privateSubnetTags"),
        protectedSubnetCidrs: config.getObject<string[]>("protectedSubnetCidrs"),
        protectedSubnetTags: config.getObject<Record<string, string>[]>("protectedSubnetTags"),
    };
    return getNetworkArgsWithDefaults(args, config.getNumber("numberOfAvailabilityZones"));
}
