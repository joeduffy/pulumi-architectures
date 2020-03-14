# AWS Base Infrastructure in TypeScript IaC

This template provides a networking foundation based on AWS best practices for your AWS infrastructure. It builds a
Virtual Private Cloud (VPC) with public and private subnets where you can launch AWS services and other resources.

## Using It

This is a Pulumi template. Although it is fully functional on its own, it's meant to be a starting point for
your own projects. To get started, first create a new project from it:

```bash
$ mkdir my-project
$ cd my-project
$ pulumi new https://github.com/joeduffy/pulumi-architectures/aws-ts-base-infra
```

This will walk you through configuring your stack. To change a configuration variable afterwards, run
`pulumi config set <key> <value>`. The available configuration variables for this program include:

* `aws:region`: the AWS region to deploy into (defaults to `us-east-1`).
* `availabilityZones`: an array of AZs to deploy into (defaults to all of the current region's).
* `numberOfAvailabilityZones`: the number of AZs to deploy into (defaults to all of them).
* `createPrivateSubnets`: set to `false` if you want to create only public subnets (defaults to `true`).
* `createProtectedSubnets`: set to `true` to create a network ACL protected subnet in each AZ (defaults to `false`).
* `vpcCidr`: configure VPC's CIDR block (defaults to `10.0.0.0/16`).
* `vpcTenancy`: configure the VPC's tenancy (defaults to `default`).
* `publicSubnetCidrs`: set the CIDR blocks for public subnets (defaults to even spread across AZs).
* `publicSubnetTags`: set the tags for public subnets.
* `privateSubnetCidrs`: set the CIDR blocks for private subnets, if enabled.
* `privateSubnetTags`: set the tags for private subnets, if enabled.
* `protectedSubnetCidrs`: set the CIDR blocks for private NACL subnets, if enabled.
* `protectedSubnetTags`: set the tags for private NACL subnets, if enabled.

## Architecture

This new environment uses the following AWS features:

* *Multi-AZ*. Use up to all of the Availability Zones (AZs) in your chosen region for high availability and disaster
  recovery. AZs are geographically distributed within a region and spaced for best insulation and stability in the
  even of a natural disaster. Maximizing AZ usage helps to insulate your application from a data center outage.

* *Separate subnets*. Public subnets are provisioned for external-facing resources and private subnets for internal
  resourcs. For each AZ, this template will create one public and one private subnet by default.

* *Additional security layers*. Network access control lists (ACLs) and firewalls are used to control inbound
  and outbound traffic at the subnet level. This template provides an option to create a network ACL protected
  subnet in each AZ, providing individual controls that you can use to customize a second layer of defense.

* *Independent routing tables*. Each private subnet gets an independent routing table to control the flow of traffic
  within and outside the VPC. All public subnets share a single routing table as they all share the same Internet
  gateway as the sole route to communicate with the Internet.

* *Highly available NAT gateways*. Using a NAT gateway instead of NAT instances offers advantages in terms of
  deployment, availability, and maintenance.

* *Spare capacity*. As your environment grows over time, this template supports adding additional subnets.

> This example has been adapted from https://aws.amazon.com/quickstart/architecture/vpc/.
