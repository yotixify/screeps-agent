import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import axios from "axios";
import { ScreepsAPI } from "screeps-api";

const config = new pulumi.Config();
const shard = config.get("shard");
const host = config.get("host") ?? "screeps.com";
const prefix = config.get("prefix");
const memoryPath = config.require("memoryPath");
const apiPath = config.get("apiPath") ?? "/";
const schedule = config.require("schedule", {
  pattern: /^(rate)|(cron)\(.*\)$/,
});

const region = pulumi.output(aws.getRegion());

const screepsTokenSecret = new aws.secretsmanager.Secret("screeps-token", {
  description: "Token in plain text for communicating with the Screeps API",
  recoveryWindowInDays: 0,
  name: "ScreepsToken",
});
const screepsPlusTokenSecret = new aws.secretsmanager.Secret(
  "screeps-plus-token",
  {
    description:
      "Token in plain text for communicating with the ScreepsPlus API",
    recoveryWindowInDays: 0,
    name: "ScreepsPlusToken",
  }
);

const secretsPolicy = new aws.iam.Policy("screeps-collect-stats-policy", {
  policy: {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: ["secretsmanager:GetSecretValue"],
        Resource: [screepsTokenSecret.arn, screepsPlusTokenSecret.arn],
      },
    ],
  },
});

const role = new aws.iam.Role("screeps-collect-stats-role", {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: "lambda.amazonaws.com",
  }),
  managedPolicyArns: [secretsPolicy.arn],
});

const collectStats = async () => {
  const secrets = new aws.sdk.SecretsManager({
    region: region.get().id,
  });

  const [screepsTokenResult, screepsPlusTokenResult] = await Promise.all(
    [screepsTokenSecret.id.get(), screepsPlusTokenSecret.id.get()].map((id) =>
      secrets
        .getSecretValue({
          SecretId: id,
        })
        .promise()
    )
  );

  const screepsToken = screepsTokenResult.SecretString;
  const screepsPlusToken = screepsPlusTokenResult.SecretString;

  if (!screepsToken) {
    throw new Error(`Missing Screeps token in ${screepsTokenSecret.arn.get()}`);
  }

  if (!screepsPlusToken) {
    throw new Error(
      `Missing ScreepsPlus token in ${screepsPlusTokenSecret.arn.get()}`
    );
  }

  const api = new ScreepsAPI({
    token: screepsToken,
    secure: true,
    host: host,
    port: 443,
    path: apiPath,
  });

  const rawMemory = await api.userMemoryGet(memoryPath, shard);
  const statsMemory = JSON.parse(rawMemory);
  const body = prefix
    ? {
        [prefix]: statsMemory,
      }
    : statsMemory;

  await axios.post("https://screepspl.us/api/stats/submit", body, {
    headers: {
      "Content-Type": "application/json",
    },
    auth: {
      username: "token",
      password: screepsPlusToken,
    },
  });
};

const collectStatsSchedule: aws.cloudwatch.EventRuleEventSubscription =
  aws.cloudwatch.onSchedule(
    "screeps-collect-stats",
    schedule,
    new aws.lambda.CallbackFunction("screeps-collect-stats", {
      role,
      callback: collectStats,
    })
  );
