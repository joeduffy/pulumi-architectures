using Aws = Pulumi.Aws;
using System;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.Linq;
using System.Threading.Tasks;

static class Config {
    // Initialize all of the config variables.
    static Config() {
        var config = new Pulumi.Config();
        AvailabilityZones = config.GetObject<string[]>("availabilityZones");
        NumberOfAvailabilityZones = config.GetInt32("numberOfAvailabilityZones");
        CreatePrivateSubnets = config.GetBoolean("createPrivateSubnets") ?? true;
        CreateProtectedSubnets = config.GetBoolean("createProtectedSubnets") ?? false;
        VpcCidr = config.Get("vpcCidr") ?? "10.0.0.0/16";
        VpcTenancy = config.Get("vpcTenancy") ?? "default";
        PublicSubnetCidrs = config.GetObject<string[]>("publicSubnetCidrs");
        PublicSubnetTags = config.GetObject<ImmutableDictionary<string, object>[]>("publicSubnetTags");
        PrivateSubnetCidrs = config.GetObject<string[]>("privateSubnetCidrs");
        PrivateSubnetTags = config.GetObject<ImmutableDictionary<string, object>[]>("privateSubnetTags");
        ProtectedSubnetCidrs = config.GetObject<string[]>("protectedSubnetCidrs");
        ProtectedSubnetTags = config.GetObject<ImmutableDictionary<string, object>[]>("protectedSubnetTags");
    }

    // List of AZs to use for the subnets in the VPC. Note: the logical order is preserved.
    public static readonly string[]? AvailabilityZones;
    // Number of AZs to use in the VPC. If both are specified, this must match your selections in the list of AZs parameter.
    public static readonly int? NumberOfAvailabilityZones;
    // Set to false to create only public subnets. If false, the CIDR parameters for ALL private subnets will be ignored.
    public static readonly bool CreatePrivateSubnets;
    // Set to true to create a network ACL protected subnet in each AZ. If false, the CIDR parameters for those
    // subnets will be ignored. If true, it also requires that the `createPrivateSubnets` parameter is also true.
    public static readonly bool CreateProtectedSubnets;
    // CIDR block for the VPC.
    public static readonly string VpcCidr;
    // The allowed tenancy of instances launched into the VPC.
    public static readonly string VpcTenancy;
    // CIDR blocks for public subnets.
    public static readonly string[]? PublicSubnetCidrs;
    // Tag to add to public subnets (an array of maps, one per AZ).
    public static readonly ImmutableDictionary<string, object>[]? PublicSubnetTags;
    // CIDR blocks for private subnets.
    public static readonly string[]? PrivateSubnetCidrs;
    // Tag to add to private subnets (an array of maps, one per AZ).
    public static readonly ImmutableDictionary<string, object>[]? PrivateSubnetTags;
    // CIDR blocks for private NACL'd subnets.
    public static readonly string[]? ProtectedSubnetCidrs;
    // Tag to add to private NACL'd subnets (an array of maps, one per AZ).
    public static readonly ImmutableDictionary<string, object>[]? ProtectedSubnetTags;

    // GetAvailabilityZones returns the list of AZs this stack should use, based on configuration parameters. If
    // "availabilityZones" is set, those exact zones are returned; else if "numberOfAzs" is set, the first AZs up
    // to that count are returned; otherwise, all AZs in the current region are returned.
    public static async Task<ImmutableArray<string>> GetAvailabilityZones() {
        if (AvailabilityZones != null) {
            return ImmutableArray.Create(AvailabilityZones);
        }
        var currentZones = await Aws.Invokes.GetAvailabilityZones();
        if (NumberOfAvailabilityZones != null) {
            return currentZones.Names.Take(NumberOfAvailabilityZones.Value).ToImmutableArray();
        }
        return currentZones.Names;
    }

    // GetPublicSubnetCidrs returns a list of CIDR blocks to use for public subnets, one per AZ.
    public static async Task<string[]> GetPublicSubnetCidrs() {
        if (PublicSubnetCidrs != null) {
            return PublicSubnetCidrs;
        }
        var azs = await GetAvailabilityZones();
        return new[] { "10.0.128.0/20", "10.0.144.0/20", "10.0.160.0/20", "10.0.176.0/20" }.Take(azs.Length).ToArray();
    }

    // GetPublicSubnetTags returns a list of tag maps to be used for public subnets, one per AZ.
    public static async Task<ImmutableDictionary<string, object>[]> GetPublicSubnetTags() {
        if (PublicSubnetTags != null) {
            return PublicSubnetTags;
        }
        var azs = await GetAvailabilityZones();
        var tags = new ImmutableDictionary<string, object>[azs.Length];
        Array.Fill(tags, new Dictionary<string, object>{ { "Network", "Public" } }.ToImmutableDictionary());
        return tags;
    }

    // GetPrivateSubnetCidrs returns a list of CIDR blocks to use for private subnets, one per AZ.
    public static async Task<string[]?> GetPrivateSubnetCidrs() {
        if (!CreatePrivateSubnets) {
            return null;
        } else if (PrivateSubnetCidrs != null) {
            return PublicSubnetCidrs;
        }
        var azs = await GetAvailabilityZones();
        return new[] { "10.0.0.0/19", "10.0.32.0/19", "10.0.64.0/19", "10.0.96.0/19" }.Take(azs.Length).ToArray();
    }

    // GetPrivateSubnetTags returns a list of tag maps to be used for private subnets, one per AZ.
    public static async Task<ImmutableDictionary<string, object>[]?> GetPrivateSubnetTags() {
        if (!CreatePrivateSubnets) {
            return null;
        } else if (PrivateSubnetTags != null) {
            return PrivateSubnetTags;
        }
        var azs = await GetAvailabilityZones();
        var tags = new ImmutableDictionary<string, object>[azs.Length];
        Array.Fill(tags, new Dictionary<string, object> { { "Network", "Private" } }.ToImmutableDictionary());
        return tags;
    }


    // GetProtectedSubnetCidrs returns a list of CIDR blocks to use for NACL'd private subnets, one per AZ.
    public static async Task<string[]?> GetProtectedSubnetCidrs() {
        if (!CreatePrivateSubnets || !CreateProtectedSubnets) {
            return null;
        } else if (ProtectedSubnetCidrs != null) {
            return PublicSubnetCidrs;
        }
        var azs = await GetAvailabilityZones();
        return new[] { "10.0.192.0/21", "10.0.200.0/21", "10.0.208.0/21", "10.0.216.0/21" }.Take(azs.Length).ToArray();
    }

    // GetProtectedSubnetTags returns a list of tag maps to be used for NACL'd private subnets, one per AZ.
    public static async Task<ImmutableDictionary<string, object>[]?> GetProtectedSubnetTags() {
        if (!CreatePrivateSubnets || !CreateProtectedSubnets) {
            return null;
        } else if (ProtectedSubnetTags != null) {
            return ProtectedSubnetTags;
        }
        var azs = await GetAvailabilityZones();
        var tags = new ImmutableDictionary<string, object>[azs.Length];
        Array.Fill(tags, new Dictionary<string, object> { { "Network", "Private" } }.ToImmutableDictionary());
        return tags;
    }
}
