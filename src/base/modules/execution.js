// modules/execution.js
const { VM } = require('vm2');

module.exports = async function executionModule(ctx) {
    const plan = ctx.execution.plan;
    if (!plan || plan.length === 0) {
        ctx.status = 'ANALYZING';
        return;
    }

    const results = [];
    for (const action of plan) {
        const fullToolName = action.op;
        const parameters = action.params || {};

        // 拆分命名空间和工具名
        const [namespace, toolName] = fullToolName.includes(':')
            ? [fullToolName.split(':')[0], fullToolName.split(':').slice(1).join(':')]
            : [null, fullToolName];

        let result;
        try {
            // 获取执行器映射
            const executorMap = ctx.getExecutorMap ? ctx.getExecutorMap() : {};

            // 确定执行器
            let executor;
            if (namespace && executorMap[namespace]) {
                executor = executorMap[namespace];
            } else if (executorMap.default) {
                executor = executorMap.default;
            } else {
                // 如果没有找到执行器，使用内置的默认执行器
                executor = defaultExecutor;
            }

            result = await executor(toolName, parameters, ctx);

            // 处理工具返回的记忆信息
            if (result && typeof result === 'object' && result.memory) {
                // 添加永久记忆
                if (result.memory.permanent) {
                    if (Array.isArray(result.memory.permanent)) {
                        result.memory.permanent.forEach(content => {
                            ctx.addPermanentMemory(content);
                        });
                    } else {
                        ctx.addPermanentMemory(result.memory.permanent);
                    }
                }

                // 添加临时记忆
                if (result.memory.temporary) {
                    const expireAfterTurns = result.memory.temporaryExpireTurns || 2;
                    if (Array.isArray(result.memory.temporary)) {
                        result.memory.temporary.forEach(content => {
                            ctx.addTemporaryMemory(content, expireAfterTurns);
                        });
                    } else {
                        ctx.addTemporaryMemory(result.memory.temporary, expireAfterTurns);
                    }
                }

                // 添加引用记忆
                if (result.memory.reference) {
                    const { description, resourceId } = result.memory.reference;
                    ctx.addReferenceMemory(description, resourceId);
                }

                // 设置工具的响应内容
                result = result.response || "操作完成";
            }
        } catch (error) {
            result = `执行失败: ${error.message}`;
        }

        results.push(result);
        ctx.execution.history.push({
            function: fullToolName,
            parameters,
            result,
        });

        // 将执行结果添加到对话历史
        ctx.addToHistory('user', `${JSON.stringify(result)}`);
    }

    // 清理过期的临时记忆
    ctx.cleanupExpiredMemory();
    ctx.status = 'ANALYZING';
};

// 默认执行器 - 处理没有命名空间的工具或默认工具
async function defaultExecutor(toolName, parameters, ctx) {
    switch (toolName) {
        case 'jscode_execution':
            return await jscodeExecution(parameters, ctx);
        case 'get_tool_detail':
            return await getToolDetail(parameters, ctx);
        case 'search_tools':
            return await searchTools(parameters, ctx);
        case 'list_tools':
            return await listTools(ctx);
        case 'add_permanent_memory':
            return await addPermanentMemory(parameters, ctx);
        case 'add_temporary_memory':
            return await addTemporaryMemory(parameters, ctx);
        case 'list_memories':
            return await listMemories(ctx);
        case 'clear_temporary_memories':
            return await clearTemporaryMemories(ctx);
        default:
            return `未知的功能: ${toolName}`;
    }
}

// 获取工具详情
async function getToolDetail(parameters, ctx) {
    const toolName = parameters.tool_name;
    if (!toolName) {
        return "缺少参数: tool_name";
    }

    // 获取工具列表
    const tools = ctx.getTools ? ctx.getTools() : [];
    const foundTool = tools.find(t => t.name === toolName);

    if (!foundTool) {
        return `未找到功能: ${toolName}`;
    }

    return {
        name: foundTool.name,
        description: foundTool.description,
        parameters: foundTool.parameters,
        isMeta: foundTool.isMeta
    };
}

// 搜索工具
async function searchTools(parameters, ctx) {
    const keywords = parameters.keywords;
    if (!keywords) {
        return "缺少参数: keywords";
    }

    // keywords = keywords.replace('1panel', '')

    // 获取工具列表
    const tools = ctx.getTools ? ctx.getTools() : [];
    const keywordList = keywords.toLowerCase().split(' ');

    const matchedTools = tools.filter(t => {
        const searchText = `${t.name} ${t.description}`.toLowerCase();
        return keywordList.some(keyword => searchText.includes(keyword));
    });
    /*  */
    return matchedTools.map(t => ({
        name: t.name,
        description: t.description,
        isMeta: t.isMeta
    }));
}

// 列出所有工具
async function listTools(ctx) {
    // 获取工具列表
    const tools = ctx.getTools ? ctx.getTools() : [];
    return tools.map(t => ({
        name: t.name,
        description: t.description,
        isMeta: t.isMeta
    }));
}

// 添加永久记忆
async function addPermanentMemory(parameters, ctx) {
    if (parameters.content) {
        ctx.addPermanentMemory(parameters.content);
        return {
            response: "已添加永久记忆",
            memory: {
                permanent: parameters.content
            }
        };
    }
    return "缺少参数: content";
}

// 添加临时记忆
async function addTemporaryMemory(parameters, ctx) {
    if (parameters.content) {
        const expireTurns = parameters.expire_turns || 2;
        ctx.addTemporaryMemory(parameters.content, expireTurns);
        return {
            response: `已添加临时记忆，将在${expireTurns}轮对话后过期`,
            memory: {
                temporary: parameters.content,
                temporaryExpireTurns: expireTurns
            }
        };
    }
    return "缺少参数: content";
}

// 列出记忆
async function listMemories(ctx) {
    const memories = ctx.getMemoryForLLM();
    return `当前记忆状态:\n${memories}`;
}

// 清除临时记忆
async function clearTemporaryMemories(ctx) {
    ctx.memory.temporary = [];
    return "已清除所有临时记忆";
}

// 执行JavaScript代码
async function jscodeExecution(parameters, ctx) {
    const code = parameters.code;
    if (!code) {
        return "缺少参数: code";
    }

    // 准备全局变量
    const globals = {
        referenceData: [],
        console: {
            log: (...args) => {
                // 将console.log输出添加到执行历史
                const output = args.map(arg =>
                    typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
                ).join(' ');
                ctx.execution.history.push({
                    function: 'jscode_execution',
                    parameters: { consoleOutput: output },
                    result: output
                });
                return output;
            }
        }
    };

    // 处理引用数据
    if (parameters.referenceData) {
        for (const refId of parameters.referenceData) {
            const data = ctx.getResource(refId);
            if (data) {
                globals.referenceData.push(data);
            }
        }
    }

    try {
        const result = executeCode(code, globals);

        return {
            response: result.toString(),
            memory: {
                temporary: `执行了JavaScript代码，结果: ${typeof result === 'object' ? JSON.stringify(result).substring(0, 4000) : String(result).substring(0, 4000)}`,
            }
        };
    } catch (error) {
        return `代码执行失败: ${error.message}`;
    }
}

// 执行代码
function executeCode(code, globals = {}) {
    const vm = new VM({
        timeout: 50000, // 50秒超时
        sandbox: globals,
    });

    try {
        return vm.run(code);
    } catch (error) {
        throw new Error(`代码执行失败: ${error.message}`);
    }
}
