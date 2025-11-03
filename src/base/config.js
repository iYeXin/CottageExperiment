// config.js - 重构为默认配置提供者，但主要配置由外部传入
const path = require('path');
const fs = require('fs');

// 默认工具列表
const defaultTools = [];

// 默认模块路径
const defaultModules = {
    message: path.join(__dirname, 'modules', 'message.js'),
    analysis: path.join(__dirname, 'modules', 'analysis.js'),
    execution: path.join(__dirname, 'modules', 'execution.js'),
};

// 默认系统提示词
const defaultSystemPrompt = '';

// 默认执行器
async function testExecutor(toolName, parameters, ctx) {
    switch (toolName) {
        case 'get_weather':
            return { temperature: 25, condition: 'Sunny' };
    }
}

const defaultExecutorMap = {
    'test': testExecutor,
}

module.exports = {
    defaultTools,
    defaultModules,
    defaultSystemPrompt,
    // 其他默认配置,
    defaultExecutorMap,
    maxRecursionDepth: 100,
    timeoutMs: 30000000,
};
