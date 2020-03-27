package main

import (
	"github.com/pulumi/pulumi-aws/sdk/go/aws"
	"github.com/pulumi/pulumi/sdk/go/pulumi"
	"github.com/pulumi/pulumi/sdk/go/pulumi/config"
)

type projectConfig struct {
	ctx *pulumi.Context
	// List of AZs to use for the subnets in the VPC. Note: the logical order is preserved.
	AvailabilityZones *[]string
	// Number of AZs to use in the VPC. If both are specified, this must match your selections in the list of AZs parameter.
	NumberOfAvailabilityZones int
	// Set to false to create only public subnets. If false, the CIDR parameters for ALL private subnets will be ignored.
	CreatePrivateSubnets bool
	// Set to true to create a network ACL protected subnet in each AZ. If false, the CIDR parameters for those
	// subnets will be ignored. If true, it also requires that the `createPrivateSubnets` parameter is also true.
	CreateProtectedSubnets bool
	// CIDR block for the VPC.
	VpcCidr string
	// The allowed tenancy of instances launched into the VPC.
	VpcTenancy string
	// CIDR blocks for public subnets.
	PublicSubnetCidrs *[]string
	// Tag to add to public subnets (an array of maps, one per AZ).
	PublicSubnetTags *[]map[string]string
	// CIDR blocks for private subnets.
	PrivateSubnetCidrs *[]string
	// Tag to add to private subnets (an array of maps, one per AZ).
	PrivateSubnetTags *[]map[string]string
	// CIDR blocks for private NACL'd subnets.
	ProtectedSubnetCidrs *[]string
	// Tag to add to private NACL'd subnets (an array of maps, one per AZ).
	ProtectedSubnetTags *[]map[string]string
}

// newProjectConfig creates a new configuration structure by parsing variables in the context.
func newProjectConfig(ctx *pulumi.Context) *projectConfig {
	cfg := projectConfig{ctx: ctx}

	// Parse out complex object structures.
	config.TryObject(ctx, "availabilityZones", &cfg.AvailabilityZones)
	config.TryObject(ctx, "publicSubnetCidrs", &cfg.PublicSubnetCidrs)
	config.TryObject(ctx, "publicSubnetTags", &cfg.PublicSubnetTags)
	config.TryObject(ctx, "privateSubnetCidrs", &cfg.PrivateSubnetCidrs)
	config.TryObject(ctx, "privateSubnetTags", &cfg.PrivateSubnetTags)
	config.TryObject(ctx, "protectedSubnetCidrs", &cfg.ProtectedSubnetCidrs)
	config.TryObject(ctx, "protectedSubnetTags", &cfg.ProtectedSubnetTags)

	// Now parse out simple data, providing defaults as appropriate.
	if v, err := config.TryInt(ctx, "numberOfAvailabilityZones"); err == nil {
		cfg.NumberOfAvailabilityZones = v
	} else {
		cfg.NumberOfAvailabilityZones = 2
	}
	if v, err := config.TryBool(ctx, "createPrivateSubnets"); err == nil {
		cfg.CreatePrivateSubnets = v
	} else {
		cfg.CreatePrivateSubnets = true
	}
	if v, err := config.TryBool(ctx, "createProtectedSubnets"); err == nil {
		cfg.CreateProtectedSubnets = v
	}
	if v, err := config.Try(ctx, "vpcCidr"); err == nil {
		cfg.VpcCidr = v
	} else {
		cfg.VpcCidr = "10.0.0.0/16"
	}
	if v, err := config.Try(ctx, "vpcTenancy"); err == nil {
		cfg.VpcTenancy = v
	} else {
		cfg.VpcTenancy = "default"
	}

	return &cfg
}

// GetAvailabilityZones returns the list of AZs this stack should use, based on configuration parameters. If
// "availabilityZones" is set, those exact zones are returned; else if "numberOfAzs" is set, the first AZs up
// to that count are returned; otherwise, all AZs in the current region are returned.
func (cfg *projectConfig) GetAvailabilityZones() []string {
	if cfg.AvailabilityZones != nil {
		return *cfg.AvailabilityZones
	}

	currentZones, err := aws.GetAvailabilityZones(cfg.ctx, nil)
	if err != nil {
		panic(err)
	}

	return currentZones.Names[:cfg.NumberOfAvailabilityZones]
}

// Define some standard defaults for CIDR blocks if they aren't specified explicitly.
var (
	defaultPublicSubnetCidrs    = []string{"10.0.128.0/20", "10.0.144.0/20", "10.0.160.0/20", "10.0.176.0/20"}
	defaultPrivateSubnetCidrs   = []string{"10.0.0.0/19", "10.0.32.0/19", "10.0.64.0/19", "10.0.96.0/19"}
	defaultProtectedSubnetCidrs = []string{"10.0.192.0/21", "10.0.200.0/21", "10.0.208.0/21", "10.0.216.0/21"}
)

// GetPublicSubnetCidrs returns a list of CIDR blocks to use for public subnets, one per AZ.
func (cfg *projectConfig) GetPublicSubnetCidrs() []string {
	if cfg.PublicSubnetCidrs != nil {
		return *cfg.PublicSubnetCidrs
	}
	return defaultPublicSubnetCidrs[:len(cfg.GetAvailabilityZones())]
}

// GetPublicSubnetTags returns a list of tag maps to be used for public subnets, one per AZ.
func (cfg *projectConfig) GetPublicSubnetTags() []map[string]string {
	if cfg.PublicSubnetTags != nil {
		return *cfg.PublicSubnetTags
	}
	var tags []map[string]string
	for range cfg.GetAvailabilityZones() {
		tags = append(tags, map[string]string{"Network": "Public"})
	}
	return tags
}

// GetPrivateSubnetCidrs returns a list of CIDR blocks to use for private subnets, one per AZ.
func (cfg *projectConfig) GetPrivateSubnetCidrs() []string {
	if !cfg.CreatePrivateSubnets {
		return nil
	}
	if cfg.PrivateSubnetCidrs != nil {
		return *cfg.PrivateSubnetCidrs
	}
	return defaultPrivateSubnetCidrs[:len(cfg.GetAvailabilityZones())]
}

// GetPrivateSubnetTags returns a list of tag maps to be used for private subnets, one per AZ.
func (cfg *projectConfig) GetPrivateSubnetTags() []map[string]string {
	if !cfg.CreatePrivateSubnets {
		return nil
	} else if cfg.PrivateSubnetTags != nil {
		return *cfg.PrivateSubnetTags
	}
	var tags []map[string]string
	for range cfg.GetAvailabilityZones() {
		tags = append(tags, map[string]string{"Network": "Private"})
	}
	return tags
}

// GetProtectedSubnetCidrs returns a list of CIDR blocks to use for NACL'd private subnets, one per AZ.
func (cfg *projectConfig) GetProtectedSubnetCidrs() []string {
	if !cfg.CreateProtectedSubnets {
		return nil
	}
	if cfg.ProtectedSubnetCidrs != nil {
		return *cfg.ProtectedSubnetCidrs
	}
	return defaultProtectedSubnetCidrs[:len(cfg.GetAvailabilityZones())]
}

// GetProtectedSubnetTags returns a list of tag maps to be used for NACL'd private subnets, one per AZ.
func (cfg *projectConfig) GetProtectedSubnetTags() []map[string]string {
	if !cfg.CreateProtectedSubnets {
		return nil
	} else if cfg.ProtectedSubnetTags != nil {
		return *cfg.ProtectedSubnetTags
	}
	var tags []map[string]string
	for range cfg.GetAvailabilityZones() {
		tags = append(tags, map[string]string{"Network": "Private"})
	}
	return tags
}
