import pulumi
import pulumi_aws as aws

# Read in the AZ and VPC configuration parameters and export them for easy consumption.
config = pulumi.Config()

# List of AZs to use for the subnets in the VPC. Note: the logical order is preserved.
availability_zones = config.get_object('availabilityZones')
# Number of AZs to use in the VPC. If both are specified, this must match your selections in the list of AZs parameter.
number_of_availability_zones = config.get_int('numberOfAvailabilityZones')
# Set to false to create only public subnets. If false, the CIDR parameters for ALL private subnets will be ignored.
create_private_subnets = True if config.get_bool('createPrivateSubnets') is None else config.get_bool('createPrivateSubnets')
# Set to true to create a network ACL protected subnet in each AZ. If false, the CIDR parameters for those
# subnets will be ignored. If true, it also requires that the `createPrivateSubnets` parameter is also true.
create_protected_subnets = config.get_bool('createProtectedSubnets')
# CIDR block for the VPC.
vpc_cidr = config.get('vpcCidr') or '10.0.0.0/16'
# The allowed tenancy of instances launched into the VPC.
vpc_tenancy = config.get('vpcTenancy') or 'default'
# CIDR blocks for public subnets.
public_subnet_cidrs = config.get_object('privateSubnetCidrs')
# Tag to add to public subnets (an array of maps, one per AZ).
public_subnet_tags = config.get_object('privateSubnetTags')
# CIDR blocks for private subnets.
private_subnet_cidrs = config.get_object('privateSubnetCidrs')
# Tag to add to private subnets (an array of maps, one per AZ).
private_subnet_tags = config.get_object('privateSubnetTags')
# CIDR blocks for private NACL'd subnets.
protected_subnet_cidrs = config.get_object('protectedSubnetCidrs')
# Tag to add to private NACL'd subnets (an array of maps, one per AZ).
protected_subnet_tags = config.get_object('protectedSubnetTags')

# get_availability_zones returns the list of AZs this stack should use, based on configuration parameters. If
# "availabilityZones" is set, those exact zones are returned; else if "numberOfAzs" is set, the first AZs up
# to that count are returned; otherwise, all AZs in the current region are returned.
def get_availability_zones():
    if availability_zones:
        return availability_zones
    current_zones = aws.get_availability_zones().names
    if number_of_availability_zones:
        return current_zones[:number_of_availability_zones]
    return current_zones

# get_public_subnet_cidrs returns a list of CIDR blocks to use for public subnets, one per AZ.
def get_public_subnet_cidrs():
    if public_subnet_cidrs:
        return public_subnet_cidrs
    return [ '10.0.128.0/20', '10.0.144.0/20', '10.0.160.0/20', '10.0.176.0/20' ][:len(get_availability_zones())]

# get_public_subnet_tags returns a list of tag maps to be used for public subnets, one per AZ.
def get_public_subnet_tags():
    if public_subnet_tags:
        return public_subnet_tags
    return [{ 'Network': 'Public' }] * len(get_availability_zones())

# get_private_subnet_cidrs returns a list of CIDR blocks to use for private subnets, one per AZ.
def get_private_subnet_cidrs():
    if not create_private_subnets:
        return None
    elif private_subnet_cidrs:
        return private_subnet_cidrs
    return [ '10.0.0.0/19', '10.0.32.0/19', '10.0.64.0/19', '10.0.96.0/19' ][:len(get_availability_zones())]

# get_private_subnet_tags returns a list of tag maps to be used for private subnets, one per AZ.
def get_private_subnet_tags():
    if not create_private_subnets:
        return None
    elif private_subnet_tags:
        return private_subnet_tags
    return [{ 'Network': 'Private' }] * len(get_availability_zones())

# get_protected_subnet_cidrs returns a list of CIDR blocks to use for NACL'd private subnets, one per AZ.
def get_protected_subnet_cidrs():
    if not create_private_subnets or not create_protected_subnets:
        return None
    elif protected_subnet_cidrs:
        return protected_subnet_cidrs
    return [ '10.0.192.0/21', '10.0.200.0/21', '10.0.208.0/21', '10.0.216.0/21' ][:len(get_availability_zones())]

# get_protected_subnet_tags returns a list of tag maps to be used for NACL'd private subnets, one per AZ.
def get_protected_subnet_tags():
    if not create_private_subnets or not create_protected_subnets:
        return None
    elif protected_subnet_tags:
        return protected_subnet_tags
    return [{ 'Network': 'Private' }] * len(get_availability_zones())
