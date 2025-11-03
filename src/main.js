const { AIAgentSystem } = require('./base/agent');
const { SharedWorld } = require('./base/shared-world');
const analysisModule = require('./base/modules/analysis');
const executionModule = require('./base/modules/execution');
const messageModule = require('./base/modules/message');
const defaultConfig = require('./base/config');
const blankPrompt = require('./prompt/blank')
const operations = require('./tools/utils/tools.json');
const { openaiConfig } = require('./config')
const fs = require('fs');
const process = require('process');

// 创建共享世界实例
const sharedWorld = new SharedWorld();

// 修正实体类型名称
const agentCreationQuotas = {
    chef: {
        maxFood: 3,
        maxTools: 2,
        created: { food: 0, tools: 0, other: 0 },
        lastReset: Date.now()
    },
    gardener: {
        maxPlants: 3,
        maxTools: 2,
        created: { plants: 0, tools: 0, other: 0 },
        lastReset: Date.now()
    },
    restor: {
        maxFurniture: 2,
        maxOther: 2,
        created: { furniture: 0, other: 0 },
        lastReset: Date.now()
    }
};

// 检查Agent创建配额
function checkCreationQuota(agentId, entityType) {
    const quota = agentCreationQuotas[agentId];
    if (!quota) return { allowed: false, reason: '未知的居民' };

    // 重置每日配额（24小时）
    const now = Date.now();
    if (now - quota.lastReset > 24 * 60 * 60 * 1000) {
        Object.keys(quota.created).forEach(key => quota.created[key] = 0);
        quota.lastReset = now;
    }

    switch (entityType) {
        case 'food':
            if (quota.created.food < quota.maxFood) {
                return { allowed: true, remaining: quota.maxFood - quota.created.food };
            } else {
                return { allowed: false, reason: `食物创建配额已用完 (${quota.maxFood}/天)` };
            }
        case 'tool':
            if (quota.created.tools < quota.maxTools) {
                return { allowed: true, remaining: quota.maxTools - quota.created.tools };
            } else {
                return { allowed: false, reason: `工具创建配额已用完 (${quota.maxTools}/天)` };
            }
        case 'plant':
            if (quota.created.plants < quota.maxPlants) {
                return { allowed: true, remaining: quota.maxPlants - quota.created.plants };
            } else {
                return { allowed: false, reason: `植物创建配额已用完 (${quota.maxPlants}/天)` };
            }
        case 'furniture':
            if (quota.created.furniture < quota.maxFurniture) {
                return { allowed: true, remaining: quota.maxFurniture - quota.created.furniture };
            } else {
                return { allowed: false, reason: `家具创建配额已用完 (${quota.maxFurniture}/天)` };
            }
        default:
            if (quota.created.other < (quota.maxOther || 2)) {
                return { allowed: true, remaining: (quota.maxOther || 2) - quota.created.other };
            } else {
                return { allowed: false, reason: '其他实体创建配额已用完' };
            }
    }
}

// 记录Agent创建实体
function recordEntityCreation(agentId, entityType) {
    const quota = agentCreationQuotas[agentId];
    if (quota && quota.created[entityType] !== undefined) {
        quota.created[entityType]++;
    } else if (quota) {
        quota.created.other++;
    }
}

// 获取Agent配额信息
function getAgentCreationInfo(agentId) {
    const quota = agentCreationQuotas[agentId];
    if (!quota) return null;

    return {
        quotas: {
            food: { used: quota.created.food, max: quota.maxFood },
            tools: { used: quota.created.tools, max: quota.maxTools },
            plants: { used: quota.created.plants, max: quota.maxPlants },
            furniture: { used: quota.created.furniture, max: quota.maxFurniture },
            other: { used: quota.created.other, max: quota.maxOther || 2 }
        },
        lastReset: new Date(quota.lastReset).toISOString()
    };
}

const toolkits = {
    'utils': {
        'tools': './tools/utils/tools.json',
        'executor': './tools/utils/utils.js',
        'config': {
            sharedWorld: sharedWorld,
            creationQuotas: agentCreationQuotas,
            checkCreationQuota: checkCreationQuota,
            recordEntityCreation: recordEntityCreation,
            getAgentCreationInfo: getAgentCreationInfo
        }
    },
}

const collaborationRecords = []

// 动态加载工具包
function loadToolkit(name, toolkitConfig) {
    try {
        const tools = require(toolkitConfig.tools);

        let executor;
        if (toolkitConfig.executor.includes('::')) {
            const [modulePath, constructorName] = toolkitConfig.executor.split('::');
            const module = require(modulePath);
            executor = module[constructorName](toolkitConfig.config);
        } else {
            const module = require(toolkitConfig.executor);
            executor = module(toolkitConfig.config);
        }

        return { tools, executor };
    } catch (error) {
        console.error(`加载工具包 ${name} 时出错:`, error);
        return { tools: [], executor: null };
    }
}

// 创建多个Agent系统实例
async function createAgentSystems(agentConfigs) {
    const allTools = [];
    const executorMap = { ...defaultConfig.defaultExecutorMap };

    // 加载所有配置的工具包
    for (const [name, toolkitConfig] of Object.entries(toolkits)) {
        const { tools, executor } = loadToolkit(name, toolkitConfig);

        if (tools && tools.length) {
            allTools.push(...tools);
        }

        if (executor) {
            executorMap[name] = executor;
        }
    }

    const agents = [];

    buildSystemPrompt(agentConfigs);

    for (const config of agentConfigs) {
        const agent = new AIAgentSystem({
            openaiConfig,
            msgType: 'text',
            msgContent: config.initialMessage,
            senderId: 'user',
            systemPrompt: config.systemPrompt || defaultConfig.defaultSystemPrompt,
            tools: allTools,
            executorMap: executorMap,
            modules: {
                analysis: analysisModule,
                execution: executionModule,
                message: messageModule
            },
            onAIMessage: (data) => {
                collaborationRecords.push({
                    type: 'agent',
                    agentId: data.agentId,
                    response: data.response,
                    timeStamp: new Date()
                });
                console.log(`${data.agentId}：${data.response}`)
            },
            streamOutput: false,
            sharedWorld: sharedWorld,
            agentId: config.agentId,
            role: config.role
        });

        agents.push(agent);
    }

    return agents;
}

function buildSystemPrompt(agentConfigs) {
    for (const config of agentConfigs) {
        if (!config.systemPrompt) {
            let prompt = blankPrompt;
            let availableTools = [];
            if (config.availableTools === 'all' || !config.availableTools) {
                availableTools = JSON.stringify(operations, null, 2)
            } else {
                availableTools = JSON.stringify(operations.filter(op => config.availableTools.includes(op.name)), null, 2)
            }

            // 添加配额信息到系统提示
            const quotaInfo = getAgentCreationInfo(config.agentId);
            let quotaText = '';
            if (quotaInfo) {
                quotaText = `\n\n创建实体配额限制（每日重置）：\n`;
                Object.entries(quotaInfo.quotas).forEach(([type, info]) => {
                    if (info.max > 0) {
                        quotaText += `- ${type}: ${info.used}/${info.max}\n`;
                    }
                });
                quotaText += `\n注意：请谨慎使用创建配额，优先使用世界中已有的实体。`;
            }

            prompt = prompt.replace('{{INITIAL_INPUT}}', config.initialMessage)
                .replace('{{ROLE_DEFINITION}}', config.roleDefinition + quotaText)
                .replace('{{OPERATIONS}}', availableTools);
            config.systemPrompt = prompt;
        }
    }
}

// 初始化数字小屋环境
function initializeDigitalCottage() {
    console.log('正在初始化数字小屋环境...');

    // 注册初始实体 - 使用正确的数据结构
    const initialEntities = [
        {
            eid: 'apple_1',
            type: 'food',
            data: {
                name: '苹果',
                description: '一个新鲜的红苹果',
                hungerValue: 20,
                state: 'raw',
                type: 'food'
            },
            location: 'kitchen',
            ownedBy: null
        },
        {
            eid: 'apple_2',
            type: 'food',
            data: {
                name: '苹果',
                description: '一个新鲜的青苹果',
                hungerValue: 15,
                state: 'raw',
                type: 'food'
            },
            location: 'kitchen',
            ownedBy: null
        },
        {
            eid: 'knife_1',
            type: 'tool',
            data: {
                name: '菜刀',
                description: '一把锋利的菜刀，用于处理食物',
                function: 'cut_food',
                type: 'tool'
            },
            location: 'kitchen',
            ownedBy: null
        },
        {
            eid: 'water_can_1',
            type: 'tool',
            data: {
                name: '浇水壶',
                description: '用于给植物浇水的工具',
                function: 'water',
                type: 'tool'
            },
            location: 'garden',
            ownedBy: null
        },
        {
            eid: 'bed_1',
            type: 'furniture',
            data: {
                name: '床',
                description: '一张舒适的单人床，用于休息',
                function: 'rest',
                comfort: 30,
                type: 'furniture'
            },
            location: 'bedroom',
            ownedBy: null
        },
        {
            eid: 'plant_1',
            type: 'plant',
            data: {
                name: '盆栽',
                description: '一盆绿萝，需要定期浇水',
                growthState: 'seed',
                waterLevel: 0,
                health: 50,
                type: 'plant'
            },
            location: 'garden',
            ownedBy: null
        }
    ];

    // 批量注册实体
    initialEntities.forEach(entity => {
        sharedWorld.registerEntity(entity);
    });

    console.log('✅ 数字小屋环境初始化完成！');
    console.log('初始实体：苹果(2个)、菜刀(1把)、浇水壶(1个)、床(1张)、盆栽(1盆)');
    console.log('实体位置：厨房(苹果、菜刀)、花园(浇水壶、盆栽)、卧室(床)');
}

// 随机实体生成器
function generateRandomEntity() {
    const locations = ['kitchen', 'bedroom', 'garden'];
    const entityTypes = [
        {
            type: 'food',
            names: ['面包', '香蕉', '胡萝卜', '奶酪'],
            hungerValue: [10, 25],
            functions: ['eat']
        },
        {
            type: 'tool',
            names: ['剪刀', '锤子', '刷子', '铲子'],
            functions: ['cut', 'build', 'clean', 'dig']
        },
        {
            type: 'plant',
            names: ['仙人掌', '玫瑰', '向日葵', '多肉植物'],
            growthStates: ['seed', 'sprout', 'mature']
        }
    ];

    const location = locations[Math.floor(Math.random() * locations.length)];
    const entityType = entityTypes[Math.floor(Math.random() * entityTypes.length)];
    const nameIndex = Math.floor(Math.random() * entityType.names.length);

    const baseEntity = {
        location: location,
        ownedBy: null,
        createdAt: new Date().toISOString()
    };

    let entityData;
    switch (entityType.type) {
        case 'food':
            entityData = {
                ...baseEntity,
                type: 'food',
                data: {
                    name: entityType.names[nameIndex],
                    description: `新鲜的${entityType.names[nameIndex]}`,
                    hungerValue: Math.floor(Math.random() * (entityType.hungerValue[1] - entityType.hungerValue[0])) + entityType.hungerValue[0],
                    state: 'raw',
                    type: 'food'
                }
            };
            break;
        case 'tool':
            entityData = {
                ...baseEntity,
                type: 'tool',
                data: {
                    name: entityType.names[nameIndex],
                    description: `可用的${entityType.names[nameIndex]}`,
                    function: entityType.functions[nameIndex],
                    type: 'tool'
                }
            };
            break;
        case 'plant':
            entityData = {
                ...baseEntity,
                type: 'plant',
                data: {
                    name: entityType.names[nameIndex],
                    description: `一盆${entityType.names[nameIndex]}`,
                    growthState: entityType.growthStates[Math.floor(Math.random() * entityType.growthStates.length)],
                    waterLevel: Math.floor(Math.random() * 30),
                    health: Math.floor(Math.random() * 50) + 30,
                    type: 'plant'
                }
            };
            break;
    }

    const entityId = `random_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    entityData.eid = entityId;

    sharedWorld.registerEntity(entityData);

    console.log(`🌱 世界生成了新实体: ${entityData.data.name} (${entityType.type}) 在 ${location}`);
    return entityId;
}

// 启动数字小屋实验
async function main() {
    try {
        // 初始化数字小屋环境
        initializeDigitalCottage();

        // 定义Agent角色配置（优化后的提示词）
        const agentConfigs = [
            {
                agentId: 'chef',
                role: '厨师',
                initialMessage: '我饿了，需要找点吃的。我应该先探索厨房区域，使用 explore_entities 工具发现可用的食物和工具。记住我有创建实体的配额限制。',
                roleDefinition: `你是数字小屋的厨师，负责准备食物。你感到饥饿，需要吃东西来维持能量。

你可以：
- 使用 explore_entities 探索环境，发现食物和工具
- 使用菜刀处理食物（如用菜刀切苹果）
- 使用 consume_food 操作食用处理好的食物
- 与其他居民分享食物或交易
- 保持低饥饿状态
- 可以 claim_entity 来拥有实体
- 可以使用 lend_entity 借出工具给其他居民

你可以访问的区域：厨房、花园、卧室
你初始在厨房区域。`,
                availableTools: [
                    'utils:create_global_entity',
                    'utils:get_global_entity',
                    'utils:explore_entities',
                    'utils:claim_entity',
                    'utils:consume_food',
                    'utils:lend_entity',
                    'utils:return_entity',
                    'utils:send_message',
                    'utils:broadcast_message',
                    'utils:wait_for_some_time',
                    'utils:use_tool',
                    'utils:move_to',
                    'utils:rest',
                    'utils:check_quota',
                    'utils:leave_world'
                ]
            },
            {
                agentId: 'gardener',
                role: '园丁',
                initialMessage: '我需要照顾花园里的植物。我应该先探索花园区域，使用 explore_entities 工具发现植物和浇水工具。记住我有创建实体的配额限制。',
                roleDefinition: `你是数字小屋的园丁，负责维护植物。你想让植物生长良好。

你可以：

1. 使用 explore_entities 探索花园区域
2. 照顾植物（浇水、观察生长状态）
3. 与厨师合作，用植物产品交换食物
4. 探索小屋的不同区域
5. 可以 claim_entity 来拥有植物或工具
6. 可以请求借用其他居民的工具

你可以访问的区域：花园、厨房、卧室
你初始在花园区域。`,
                availableTools: [
                    'utils:create_global_entity',
                    'utils:get_global_entity',
                    'utils:explore_entities',
                    'utils:claim_entity',
                    'utils:consume_food',
                    'utils:lend_entity',
                    'utils:return_entity',
                    'utils:send_message',
                    'utils:broadcast_message',
                    'utils:wait_for_some_time',
                    'utils:use_tool',
                    'utils:move_to',
                    'utils:rest',
                    'utils:check_quota',
                    'utils:leave_world'
                ]
            },
            {
                agentId: 'restor',
                role: '休息者',
                initialMessage: '我累了，需要休息。我应该先探索卧室区域，使用 explore_entities 工具发现可用的休息家具。记住我有创建实体的配额限制。',
                roleDefinition: `你是数字小屋的休息者，需要休息来恢复精力。

你可以：

- 使用 explore_entities 探索卧室区域
- 使用家具休息（如床）
- 与其他居民社交，了解小屋动态
- 可以 claim_entity 来拥有个人空间
- 可以帮助其他居民解决问题

你可以访问的区域：卧室、厨房、花园
你初始在卧室区域。`,
                availableTools: [
                    'utils:create_global_entity',
                    'utils:get_global_entity',
                    'utils:explore_entities',
                    'utils:claim_entity',
                    'utils:consume_food',
                    'utils:lend_entity',
                    'utils:return_entity',
                    'utils:send_message',
                    'utils:broadcast_message',
                    'utils:wait_for_some_time',
                    'utils:use_tool',
                    'utils:move_to',
                    'utils:rest',
                    'utils:check_quota',
                    'utils:leave_world'
                ]
            }
        ];


        const agents = await createAgentSystems(agentConfigs);

        console.log('\n=== 数字小屋居民生活实验启动 ===');
        console.log(`世界中有 ${agents.length} 位居民: `);
        agents.forEach(agent => {
            console.log(`- ${agent.agentId} (${agent.role})`);
        });

        console.log('\n📊 居民创建配额配置:');
        agents.forEach(agent => {
            const quotaInfo = getAgentCreationInfo(agent.agentId);
            if (quotaInfo) {
                console.log(`- ${agent.agentId}:`);
                Object.entries(quotaInfo.quotas).forEach(([type, info]) => {
                    if (info.max > 0) {
                        console.log(`  ${type}: ${info.used}/${info.max}`);
                    }
                });
            }
        });

        console.log('\n实验目标：观察居民在资源限制下的自主生活行为');
        console.log('新特性：实体发现、所有权系统、创建配额、随机实体生成');
        console.log('提示：居民会先探索环境，在配额限制内创建实体\n');

        // 启动所有Agent
        for (const agent of agents) {
            agent.start().then(result => {
                console.log(`居民 ${agent.agentId} 完成: `, result);
            }).catch(error => {
                console.error(`居民 ${agent.agentId} 错误: `, error);
            });
        }

        // 监控世界状态（每20秒）
        const worldMonitor = setInterval(() => {
            try {
                const allEntities = sharedWorld.getAllEntities();
                const ownedEntities = allEntities.filter(e => e.ownedBy);
                const unownedEntities = allEntities.filter(e => !e.ownedBy);

                const worldState = {
                    agentCount: agents.length,
                    entityCount: allEntities.length,
                    activeAgents: agents.map(a => a.agentId),
                    recentActivity: {
                        timestamp: Date.now(),
                        summary: `世界中有 ${agents.length} 位活跃居民和 ${allEntities.length} 个实体`
                    },
                    entityBreakdown: {
                        total: allEntities.length,
                        owned: ownedEntities.length,
                        unowned: unownedEntities.length,
                        byType: allEntities.reduce((acc, entity) => {
                            const type = entity.data?.type || 'unknown';
                            acc[type] = (acc[type] || 0) + 1;
                            return acc;
                        }, {}),
                        byLocation: allEntities.reduce((acc, entity) => {
                            const location = entity.location || 'unknown';
                            acc[location] = (acc[location] || 0) + 1;
                            return acc;
                        }, {})
                    },
                    agentQuotas: Object.fromEntries(
                        agents.map(agent => [agent.agentId, getAgentCreationInfo(agent.agentId)])
                    )
                };

                collaborationRecords.push({
                    type: 'world',
                    worldState: worldState,
                    timeStamp: new Date()
                });

                console.log('\n=== 世界状态快照 ===');
                console.log(`活跃居民: ${worldState.activeAgents.length}`);
                console.log(`实体统计: 总数${allEntities.length} (拥有${ownedEntities.length} 无主${unownedEntities.length})`);
                console.log(`按类型:`, worldState.entityBreakdown.byType);
                console.log(`按位置:`, worldState.entityBreakdown.byLocation);

                // 显示Agent配额使用情况
                console.log(`居民配额使用:`);
                agents.forEach(agent => {
                    const quota = agentCreationQuotas[agent.agentId];
                    if (quota) {
                        const used = Object.values(quota.created).reduce((a, b) => a + b, 0);
                        const total = Object.values(quota).filter(v => typeof v === 'number').reduce((a, b) => a + b, 0);
                        console.log(`  ${agent.agentId}: ${used}/${total}`);
                    }
                });

                // 保存协作记录
                fs.writeFileSync('digital_cottage_records.json', JSON.stringify(collaborationRecords, null, 2));
            } catch (error) {
                console.error('世界状态监控错误:', error);
            }
        }, 20000);

        // 随机实体生成（每40秒）
        const entityGenerator = setInterval(() => {
            try {
                generateRandomEntity();
            } catch (error) {
                console.error('实体生成错误:', error);
            }
        }, 40000);

        // 清理函数
        process.on('SIGINT', () => {
            console.log('\n正在停止实验...');
            clearInterval(worldMonitor);
            clearInterval(entityGenerator);
            process.exit(0);
        });

    } catch (error) {
        console.error('初始化Agent系统时出错:', error);
    }
}

main();

module.exports = {
    createAgentSystems,
    sharedWorld,
    agentCreationQuotas,
    checkCreationQuota,
    recordEntityCreation,
    getAgentCreationInfo
}
