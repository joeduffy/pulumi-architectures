import * as pulumi from "@pulumi/pulumi";
import { Network } from "./component";
import * as config from "./config";
import * as utils from "./utils";

// Always export the component so that typings get generated.
export * from "./component";

// If we're running this as a program rather than a library, create the network.
if (utils.isPulumiMain(module)) {
    module.exports = async function() {
        // Fetch the configuration for this stack.
        const args = await config.getNetworkArgs();

        // If we're using the component as a project directly, simply instantiate it using config.
        const network = new Network(`${pulumi.getProject()}-${pulumi.getStack()}`, args);

        // Export all of the resulting network properties that upstream stacks may want to consume.
        return {
            vpcId: network.vpc.id,
            vpcCidr: network.vpc.cidrBlock,
            natEips: network.natEips,
            publicSubnetIds: network.publicSubnetIds,
            publicSubnetCidrs: network.publicSubnetCidrs,
            privateSubnetIds: network.privateSubnetIds,
            privateSubnetCidrs: network.privateSubnetCidrs,
            protectedSubnetIds: network.protectedSubnetIds,
            protectedSubnetCidrs: network.protectedSubnetCidrs,
            s3VpcEndpointId: network.s3VpcEndpointId,
        };
    }
}
