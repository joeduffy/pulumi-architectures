import json
import pulumi
import pulumi_aws as aws
from pulumi_aws.config import region
import config

# Create a VPC.
vpc = aws.ec2.Vpc('VPC',
    cidr_block = config.vpc_cidr,
    instance_tenancy = config.vpc_tenancy,
    enable_dns_support = True,
    enable_dns_hostnames = True,
    tags = { 'Name': f'{pulumi.get_project()}-{pulumi.get_stack()}' },
)

# Associate DHCP options with our VPC.
dhcp_options = aws.ec2.VpcDhcpOptions('DHCPOptions',
    domain_name = 'ec.internal' if region == 'us-east-1' else f'{region}.compute.internal',
    domain_name_servers = [ 'AmazonProvidedDNS' ],
)
vpc_dhcp_options_association = aws.ec2.VpcDhcpOptionsAssociation('VPCDHCPOptionsAssociation',
    vpc_id = vpc.id,
    dhcp_options_id = dhcp_options.id,
)

# Create an Internet Gateway for our public subnet to connect to the Internet.
internet_gateway = aws.ec2.InternetGateway('InternetGateway',
    vpc_id = vpc.id,
    tags = { 'Name': f'{pulumi.get_project()}-{pulumi.get_stack()}' },
)

# Create a Route Table for public subnets to use the Internet Gateway for 0.0.0.0/0 traffic.
public_subnet_route_table = aws.ec2.RouteTable('PublicSubnetRouteTable',
    vpc_id = vpc.id,
    tags = {
        'Name': 'Public Subnets',
        'Network': 'Public',
    },
)
public_subnet_route = aws.ec2.Route('PublicSubnetRoute',
    route_table_id = public_subnet_route_table.id,
    destination_cidr_block = '0.0.0.0/0',
    gateway_id = internet_gateway.id,
)

# For each AZ, create the NAT Gateways and public and private subnets. Keep track of various properties
# so that they can be exported as top-level stack exports later on.
azs = config.get_availability_zones()
nat_eips = []
public_subnet_ids = []
public_subnet_cidrs = config.get_public_subnet_cidrs()
public_subnet_tags = config.get_public_subnet_tags()
private_subnet_ids = []
private_subnet_cidrs = config.get_private_subnet_cidrs()
private_subnet_tags = config.get_private_subnet_tags()
protected_subnet_ids = []
protected_subnet_cidrs = config.get_protected_subnet_cidrs()
protected_subnet_tags = config.get_protected_subnet_tags()
private_subnet_route_table_ids = []
for i in range(0, len(azs)):
    az = azs[i]

    # Each AZ gets a public subnet.
    public_subnet = aws.ec2.Subnet(f'public_subnet{i}',
        vpc_id = vpc.id,
        availability_zone = az,
        cidr_block = public_subnet_cidrs[i],
        map_public_ip_on_launch = True,
        tags = { **public_subnet_tags[i], 'Name': f'Public subnet {i}' },
    )
    public_subnet_ids.append(public_subnet.id)

    public_subnetRouteTableAssociation = aws.ec2.RouteTableAssociation(f'PublicSubnet{i}RouteTableAssociation',
        subnet_id = public_subnet.id,
        route_table_id = public_subnet_route_table.id,
    )

    # If desired, create a NAT Gateway and private subnet for each AZ.
    if config.create_private_subnets:
        nat_eip = aws.ec2.Eip(f'NAT{i}EIP',
            vpc = True,
            opts = pulumi.ResourceOptions(depends_on = [ internet_gateway ]),
        )
        nat_gateway = aws.ec2.NatGateway(f'NATGateway{i}',
            subnet_id = public_subnet.id,
            allocation_id = nat_eip.id,
        )
        nat_eips.append(nat_eip.public_ip)

        private_subnet = aws.ec2.Subnet(f'PrivateSubnet{i}A',
            vpc_id = vpc.id,
            availability_zone = az,
            cidr_block = private_subnet_cidrs[i],
            tags = { **private_subnet_tags[i], 'Name': f'Private subnet {i}A' },
        )
        private_subnet_ids.append(private_subnet.id)

        private_subnet_route_table = aws.ec2.RouteTable(f'PrivateSubnet{i}ARouteTable',
            vpc_id = vpc.id,
            tags = {
                'Name': f'Private subnet {i}A',
                'Network': 'Private',
            },
        )
        private_subnet_route = aws.ec2.Route(f'PrivateSubnet{i}ARoute',
            route_table_id = private_subnet_route_table.id,
            destination_cidr_block = '0.0.0.0/0',
            nat_gateway_id = nat_gateway.id,
        )
        private_subnet_route_table_association = aws.ec2.RouteTableAssociation(f'PrivateSubnet{i}ARouteTableAssociation',
            subnet_id = private_subnet.id,
            route_table_id = private_subnet_route_table.id,
        )

        # Remember the route table ID for the VPC endpoint later.
        private_subnet_route_table_ids.append(private_subnet_route_table.id)

        # If desired, create additional private subnets with dedicated network ACLs for extra protection.
        if config.create_protected_subnets:
            protected_subnet = aws.ec2.Subnet(f'PrivateSubnet${i}B',
                vpc_id = vpc.id,
                availability_zone = az,
                cidr_block = protected_subnet_cidrs[i],
                tags = { **protected_subnet_tags[i], 'Name': f'Private subnet {i}B' },
            )
            protected_subnet_ids.append(protected_subnet.id)

            protected_subnet_route_table = aws.ec2.RouteTable(f'PrivateSubnet{i}BRouteTable',
                vpc_id = vpc.id,
                tags = {
                    'Name': f'Private subnet {i}B',
                    'Network': 'Private',
                },
            )
            protected_subnet_route = aws.ec2.Route(f'PrivateSubnet{i}BRoute',
                route_table_id = protected_subnet_route_table.id,
                destination_cidr_block = '0.0.0.0/0',
                nat_gateway_id = nat_gateway.id,
            )
            protected_subnet_route_table_association = aws.ec2.RouteTableAssociation(f'PrivateSubnet{i}BRouteTableAssociation',
                subnet_id = protected_subnet.id,
                route_table_id = protected_subnet_route_table.id,
            )
            protectedSubnetNetworkAcl = aws.ec2.NetworkAcl(f'PrivateSubnet{i}BNetworkAcl',
                vpc_id = vpc.id,
                subnet_ids = [ protected_subnet.id ],
                tags = {
                    'Name': f'NACL protected subnet {i}',
                    'Network': 'NACL Protected',
                },
            )
            protected_subnet_nacl_rule_inbound = aws.ec2.NetworkAclRule(f'PrivateSubnet{i}BNetworkAclEntryInbound',
                network_acl_id = protected_subnet_network_acl.id,
                cidr_block = '0.0.0.0/0',
                egress = False,
                protocol = '-1',
                rule_action = 'allow',
                rule_number = 100,
            )
            protected_subnet_nacl_rule_outbound = aws.ec2.NetworkAclRule(f'PrivateSubnet{i}BNetworkAclEntryOutbound',
                network_acl_id = protected_subnet_network_acl.id,
                cidr_block = '0.0.0.0/0',
                egress = True,
                protocol = '-1',
                rule_action = 'allow',
                rule_number = 100,
            )

            # Remember the route table ID for the VPC endpoint later.
            private_subnet_route_table_ids.append(protected_subnet_route_table.id)

# If we created private subnets, allocate an S3 VPC Endpoint to simplify access to S3.
s3_vpc_endpoint_id = None
if config.create_private_subnets:
    s3_vpc_endpoint_id = aws.ec2.VpcEndpoint('S3VPCEndpoint',
        vpc_id = vpc.id,
        policy = json.dumps({
            'Version': '2012-10-17',
            'Statement': [{
                'Action': '*',
                'Effect': 'Allow',
                'Resource': '*',
                'Principal': '*',
            }],
        }),
        route_table_ids = private_subnet_route_table_ids,
        service_name = f'com.amazonaws.{region}.s3',
    ).id

# Export all of the resulting properties that upstream stacks may want to consume.
pulumi.export('vpcId', vpc.id)
pulumi.export('vpcCidr', vpc.cidr_block)
pulumi.export('netEips', nat_eips)
pulumi.export('publicSubnetIds', public_subnet_ids)
pulumi.export('publicSubnetCidrs', public_subnet_cidrs)
pulumi.export('publicSubnetRouteTableId', public_subnet_route_table.id)
pulumi.export('privateSubnetIds', private_subnet_ids)
pulumi.export('privateSubnetCidrs', private_subnet_cidrs)
pulumi.export('protectedSubnetIds', protected_subnet_ids)
pulumi.export('protectedSubnetCidrs', protected_subnet_cidrs)
pulumi.export('privateSubnetRouteTableIds', private_subnet_route_table_ids)
pulumi.export('s3VpcEndpointId', s3_vpc_endpoint_id)
