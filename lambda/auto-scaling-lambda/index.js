const AWS = require("aws-sdk");
const fetch = require('node-fetch');
AWS.config.update({ region: 'us-west-2' });
const { env } = require("process");

const SECRET_NAME = env.SECRET_NAME
const SECRET_REGION = env.SECRET_REGION
const AUTO_SCALING_MAX = env.AUTO_SCALING_MAX
const AUTO_SCALING_GROUP_NAME = env.AUTO_SCALING_GROUP_NAME
const AUTO_SCALING_GROUP_REGION = env.AUTO_SCALING_GROUP_REGION

exports.handler = async (event, context) => {
    return await getTasks().then(async (data) => {
        let numInstances = 0;
        if (data["unclaimed_task_count"] < AUTO_SCALING_MAX) {
            numInstances = data["unclaimed_task_count"];
        } else {
            numInstances = AUTO_SCALING_MAX;
        }

        await updateNumInstances(numInstances);
        return numInstances;
    });
};

async function updateNumInstances(numInstances) {
    const autoScaling = new AWS.AutoScaling({ region: AUTO_SCALING_GROUP_REGION });
    const params = {
        AutoScalingGroupName: AUTO_SCALING_GROUP_NAME,
        MinSize: 0,
        MaxSize: AUTO_SCALING_MAX,
        DesiredCapacity: numInstances
    };
    await autoScaling.updateAutoScalingGroup(params).promise();
}

async function getTasks() {
    const secret = await getSecret();
    const url = `https://runner.circleci.com/api/v2/tasks?resource-class=${secret['resource_class']}`;
    const headers = {
        'Circle-Token': secret['circle_token']
    }

    const response = await fetch(url, {
        headers: headers
    });
    const data = await response.json();
    return data;
}

async function getSecret() {
    const params = {
        SecretId: SECRET_NAME
    };
    const data = await new AWS.SecretsManager({ region: SECRET_REGION }).getSecretValue(params).promise();
    if ('SecretString' in data) {
        let secret = JSON.parse(data.SecretString);
        return secret;
    } else {
        let buff = new Buffer(data.SecretBinary, 'base64');
        let decodedBinarySecret = buff.toString('ascii');
        return JSON.parse(decodedBinarySecret);
    }
}