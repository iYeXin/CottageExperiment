class UtilsToolkit {
    constructor(config) {
        this.fileEntities = config.initialFileEntities || [];
        this.actualDirectories = config.actualDirectories || [];
        this.sharedWorld = config.sharedWorld || null;
        this.creationQuotas = config.creationQuotas || {};
        this.checkCreationQuota = config.checkCreationQuota || (() => ({ allowed: true }));
        this.recordEntityCreation = config.recordEntityCreation || (() => { });
        this.getAgentCreationInfo = config.getAgentCreationInfo || (() => ({}));

        // 借用系统
        this.borrowedEntities = new Map(); // entityId -> { borrowedBy, borrowedFrom, borrowedUntil }
    }

    async execute(toolName, parameters, ctx) {
        try {
            switch (toolName) {
                case "create_global_entity":
                    return await this.createGlobalEntity(parameters, ctx);
                case "get_global_entity":
                    return await this.getGlobalEntity(parameters, ctx);
                case "explore_entities":
                    return await this.exploreEntities(parameters, ctx);
                case "check_quota":
                    return await this.checkQuota(parameters, ctx);
                case "claim_entity":
                    return await this.claimEntity(parameters, ctx);
                case "consume_food":
                    return await this.consumeFood(parameters, ctx);
                case "lend_entity":
                    return await this.lendEntity(parameters, ctx);
                case "return_entity":
                    return await this.returnEntity(parameters, ctx);
                case "send_message":
                    return await this.sendMessage(parameters, ctx);
                case "broadcast_message":
                    return await this.broadcastMessage(parameters, ctx);
                case "wait_for_some_time":
                    return await this.waitSomeTime(parameters, ctx);
                case "use_tool":
                    return await this.useTool(parameters, ctx);
                case "move_to":
                    return await this.moveTo(parameters, ctx);
                case "rest":
                    return await this.rest(parameters, ctx);
                default:
                    return {
                        op_result: "error",
                        error: `未知的工具: ${toolName}`
                    };
            }
        } catch (error) {
            console.error(`工具执行错误 ${toolName}:`, error);
            return {
                op_result: "error",
                error: `工具执行失败: ${error.message}`
            };
        }
    }

    async createGlobalEntity(parameters, ctx) {
        if (!this.sharedWorld) {
            return {
                op_result: "error",
                error: "共享世界不可用"
            };
        }

        const { entityData, description } = parameters;

        // 检查创建配额
        const entityType = entityData.type || entityData.data?.type;
        const quotaCheck = this.checkCreationQuota(ctx.agentId, entityType);

        if (!quotaCheck.allowed) {
            return {
                op_result: "error",
                error: `创建实体失败: ${quotaCheck.reason}`
            };
        }

        // 确保实体数据有正确的结构
        const completeEntityData = {
            ...entityData,
            createdBy: ctx.agentId,
            ownedBy: ctx.agentId, // 创建者自动拥有
            description: description,
            createdAt: new Date().toISOString()
        };

        // 确保data对象包含type字段
        if (!completeEntityData.data) {
            completeEntityData.data = {};
        }
        if (!completeEntityData.data.type && completeEntityData.type) {
            completeEntityData.data.type = completeEntityData.type;
        }

        const entityId = this.sharedWorld.registerEntity(completeEntityData);

        // 记录创建
        this.recordEntityCreation(ctx.agentId, entityType);

        return {
            op_result: "success",
            world_resp: {
                eid: entityId,
                type: completeEntityData.type,
                message: `全局实体已创建: ${entityId}`,
                entityData: completeEntityData,
                ownedBy: ctx.agentId,
                quotaRemaining: quotaCheck.remaining - 1,
                quotaInfo: `剩余配额: ${quotaCheck.remaining - 1}`
            }
        };
    }

    async consumeFood(parameters, ctx) {
        if (!this.sharedWorld) {
            return {
                op_result: "error",
                error: "共享世界不可用"
            };
        }

        const { foodEntityId } = parameters;
        const foodEntity = this.sharedWorld.getEntity(foodEntityId);

        if (!foodEntity) {
            return {
                op_result: "error",
                error: `食物实体不存在: ${foodEntityId}`
            };
        }

        const foodType = foodEntity.data?.type;
        if (foodType !== 'food') {
            return {
                op_result: "error",
                error: `该实体不是食物: ${foodEntityId}`
            };
        }

        // 检查使用权：拥有、无主、或借用
        const canUse = this.canUseEntity(foodEntity, ctx.agentId);
        if (!canUse) {
            return {
                op_result: "error",
                error: `无法食用：食物被 ${foodEntity.ownedBy} 拥有`
            };
        }

        // 获取食物信息
        const foodName = foodEntity.data?.name || '未知食物';
        const hungerValue = foodEntity.data?.hungerValue || 15;

        // 删除食物实体（食用后消失）
        this.sharedWorld.globalEntities.delete(foodEntityId);
        this.borrowedEntities.delete(foodEntityId);

        return {
            op_result: "success",
            world_resp: {
                message: `你食用了${foodName}，感觉不那么饿了。恢复了${hungerValue}点饥饿值。`,
                foodName: foodName,
                hungerValue: hungerValue,
                consumedBy: ctx.agentId,
                timestamp: new Date().toISOString()
            }
        };
    }

    async lendEntity(parameters, ctx) {
        if (!this.sharedWorld) {
            return {
                op_result: "error",
                error: "共享世界不可用"
            };
        }

        const { entityId, toResidentId, duration = 60 } = parameters;
        const entity = this.sharedWorld.getEntity(entityId);

        if (!entity) {
            return {
                op_result: "error",
                error: `实体不存在: ${entityId}`
            };
        }

        // 检查所有权
        if (entity.ownedBy !== ctx.agentId) {
            return {
                op_result: "error",
                error: `无法借出：实体不属于你`
            };
        }

        // 检查是否已经借出
        if (this.borrowedEntities.has(entityId)) {
            return {
                op_result: "error",
                error: `该实体已经被借出`
            };
        }

        // 记录借用信息
        const borrowedUntil = Date.now() + (duration * 1000);
        this.borrowedEntities.set(entityId, {
            borrowedBy: toResidentId,
            borrowedFrom: ctx.agentId,
            borrowedUntil: borrowedUntil,
            duration: duration
        });

        // 发送消息通知借入者
        this.sharedWorld.sendMessage(toResidentId, {
            content: `居民 ${ctx.agentId} 将 ${entity.data?.name || '实体'} 借给你使用 ${duration} 秒。你可以使用 use_tool 操作来使用它。`,
            from: 'system',
            type: 'borrow_notification',
            timestamp: new Date().toISOString()
        });

        return {
            op_result: "success",
            world_resp: {
                message: `成功将 ${entity.data?.name || '实体'} 借给 ${toResidentId}，借用时间 ${duration} 秒`,
                entityId: entityId,
                borrowedTo: toResidentId,
                duration: duration,
                borrowedUntil: new Date(borrowedUntil).toISOString()
            }
        };
    }

    async returnEntity(parameters, ctx) {
        if (!this.sharedWorld) {
            return {
                op_result: "error",
                error: "共享世界不可用"
            };
        }

        const { entityId } = parameters;
        const borrowInfo = this.borrowedEntities.get(entityId);

        if (!borrowInfo) {
            return {
                op_result: "error",
                error: `该实体没有被借用`
            };
        }

        // 检查是否是借入者
        if (borrowInfo.borrowedBy !== ctx.agentId) {
            return {
                op_result: "error",
                error: `你无法归还这个实体，因为你不是借入者`
            };
        }

        const entity = this.sharedWorld.getEntity(entityId);
        const originalOwner = borrowInfo.borrowedFrom;

        // 删除借用记录
        this.borrowedEntities.delete(entityId);

        // 发送消息通知原拥有者
        this.sharedWorld.sendMessage(originalOwner, {
            content: `居民 ${ctx.agentId} 已经归还了 ${entity.data?.name || '实体'}`,
            from: 'system',
            type: 'return_notification',
            timestamp: new Date().toISOString()
        });

        return {
            op_result: "success",
            world_resp: {
                message: `成功归还 ${entity.data?.name || '实体'} 给 ${originalOwner}`,
                entityId: entityId,
                returnedTo: originalOwner,
                timestamp: new Date().toISOString()
            }
        };
    }

    // 检查实体使用权限
    canUseEntity(entity, agentId) {
        // 实体无主
        if (!entity.ownedBy) {
            return true;
        }
        // 实体属于当前居民
        if (entity.ownedBy === agentId) {
            return true;
        }
        // 实体被借给当前居民
        const borrowInfo = this.borrowedEntities.get(entity.eid);
        if (borrowInfo && borrowInfo.borrowedBy === agentId && Date.now() < borrowInfo.borrowedUntil) {
            return true;
        }
        return false;
    }

    async checkQuota(parameters, ctx) {
        const { entityType } = parameters;
        const quotaInfo = this.getAgentCreationInfo(ctx.agentId);

        if (!quotaInfo) {
            return {
                op_result: "error",
                error: "无法获取配额信息"
            };
        }

        // 修正实体类型名称
        const correctedType = this.correctEntityType(entityType);

        if (correctedType) {
            const specificQuota = quotaInfo.quotas[correctedType];
            if (!specificQuota) {
                return {
                    op_result: "error",
                    error: `未知的实体类型: ${entityType}`
                };
            }

            return {
                op_result: "success",
                world_resp: {
                    entityType: correctedType,
                    used: specificQuota.used,
                    max: specificQuota.max,
                    remaining: specificQuota.max - specificQuota.used,
                    message: `${correctedType}配额: ${specificQuota.used}/${specificQuota.max} (剩余${specificQuota.max - specificQuota.used})`
                }
            };
        } else {
            // 返回所有配额信息
            const allQuotas = Object.entries(quotaInfo.quotas)
                .filter(([type, info]) => info.max > 0)
                .map(([type, info]) => ({
                    type,
                    used: info.used,
                    max: info.max,
                    remaining: info.max - info.used
                }));

            return {
                op_result: "success",
                world_resp: {
                    quotas: allQuotas,
                    lastReset: quotaInfo.lastReset,
                    message: `你的创建配额: ${allQuotas.map(q => `${q.type}:${q.used}/${q.max}`).join(', ')}`
                }
            };
        }
    }

    // 修正实体类型名称
    correctEntityType(type) {
        const corrections = {
            'tool': 'tools',
            'plant': 'plants',
            'food': 'food',
            'furniture': 'furniture'
        };
        return corrections[type] || type;
    }

    async getGlobalEntity(parameters, ctx) {
        if (!this.sharedWorld) {
            return {
                op_result: "error",
                error: "共享世界不可用"
            };
        }

        const { entityId } = parameters;
        const entity = this.sharedWorld.getEntity(entityId);

        if (entity) {
            // 检查借用状态
            const borrowInfo = this.borrowedEntities.get(entityId);
            const entityWithBorrowInfo = {
                ...entity,
                canUse: this.canUseEntity(entity, ctx.agentId)
            };

            if (borrowInfo) {
                entityWithBorrowInfo.borrowedInfo = {
                    borrowedBy: borrowInfo.borrowedBy,
                    borrowedFrom: borrowInfo.borrowedFrom,
                    borrowedUntil: new Date(borrowInfo.borrowedUntil).toISOString(),
                    remainingTime: Math.max(0, Math.floor((borrowInfo.borrowedUntil - Date.now()) / 1000))
                };
            }

            return {
                op_result: "success",
                world_resp: entityWithBorrowInfo
            };
        } else {
            return {
                op_result: "error",
                error: `未找到实体: ${entityId}`
            };
        }
    }

    async exploreEntities(parameters, ctx) {
        if (!this.sharedWorld) {
            return {
                op_result: "error",
                error: "共享世界不可用"
            };
        }

        const { location, entityType, limit = 5, random = true } = parameters;
        let allEntities = this.sharedWorld.getAllEntities();

        console.log(`探索实体: 位置=${location}, 类型=${entityType}, 总数=${allEntities.length}`);

        // 过滤实体
        let filteredEntities = allEntities;
        if (location) {
            filteredEntities = filteredEntities.filter(entity => entity.location === location);
        }
        if (entityType) {
            filteredEntities = filteredEntities.filter(entity =>
                entity.data && entity.data.type === entityType
            );
        }

        console.log(`过滤后实体数: ${filteredEntities.length}`);

        // 随机选择
        if (random && filteredEntities.length > 0) {
            filteredEntities = filteredEntities
                .sort(() => 0.5 - Math.random())
                .slice(0, limit);
        } else if (limit > 0) {
            filteredEntities = filteredEntities.slice(0, limit);
        }

        // 格式化返回信息
        const formattedEntities = filteredEntities.map(entity => {
            const borrowInfo = this.borrowedEntities.get(entity.eid);
            const canUse = this.canUseEntity(entity, ctx.agentId);

            return {
                eid: entity.eid,
                type: entity.data?.type || 'unknown',
                name: entity.data?.name || '未命名实体',
                description: entity.data?.description || '无描述',
                location: entity.location || '未知位置',
                ownedBy: entity.ownedBy,
                canUse: canUse,
                isBorrowed: !!borrowInfo,
                borrowedBy: borrowInfo?.borrowedBy,
                borrowedFrom: borrowInfo?.borrowedFrom
            };
        });

        return {
            op_result: "success",
            world_resp: {
                entities: formattedEntities,
                count: formattedEntities.length,
                totalInWorld: allEntities.length,
                filters: { location, entityType, limit, random },
                message: `发现 ${formattedEntities.length} 个实体` +
                    (location ? ` 在 ${location}` : '') +
                    (entityType ? ` 类型为 ${entityType}` : '')
            }
        };
    }

    async claimEntity(parameters, ctx) {
        if (!this.sharedWorld) {
            return {
                op_result: "error",
                error: "共享世界不可用"
            };
        }

        const { entityId } = parameters;
        const entity = this.sharedWorld.getEntity(entityId);

        if (!entity) {
            return {
                op_result: "error",
                error: `实体不存在: ${entityId}`
            };
        }

        // 检查是否被借用
        const borrowInfo = this.borrowedEntities.get(entityId);
        if (borrowInfo && borrowInfo.borrowedBy !== ctx.agentId) {
            return {
                op_result: "error",
                error: `实体被 ${borrowInfo.borrowedBy} 借用中，无法声明所有权`
            };
        }

        if (entity.ownedBy && entity.ownedBy !== ctx.agentId) {
            return {
                op_result: "error",
                error: `实体已被 ${entity.ownedBy} 拥有，无法声明所有权`
            };
        }

        if (entity.ownedBy === ctx.agentId) {
            return {
                op_result: "success",
                world_resp: {
                    message: `你已拥有该实体: ${entityId}`,
                    entity: entity
                }
            };
        }

        // 声明所有权
        entity.ownedBy = ctx.agentId;
        this.sharedWorld.updateEntity(entityId, entity);

        return {
            op_result: "success",
            world_resp: {
                message: `成功声明实体所有权: ${entityId}`,
                entity: entity,
                ownedBy: ctx.agentId
            }
        };
    }

    async sendMessage(parameters, ctx) {
        if (!this.sharedWorld) {
            return {
                op_result: "error",
                error: "共享世界不可用"
            };
        }

        const { toAgentId, content } = parameters;
        this.sharedWorld.sendMessage(toAgentId, {
            content,
            from: ctx.agentId,
            type: 'agent_message',
            timestamp: new Date().toISOString()
        });

        return {
            op_result: "success",
            world_resp: {
                message: `消息已发送给居民 ${toAgentId}`,
                content: content
            }
        };
    }

    async broadcastMessage(parameters, ctx) {
        if (!this.sharedWorld) {
            return {
                op_result: "error",
                error: "共享世界不可用"
            };
        }

        const { content } = parameters;
        this.sharedWorld.broadcastMessage({
            content,
            from: ctx.agentId,
            type: 'broadcast_message',
            timestamp: new Date().toISOString()
        }, ctx.agentId);

        return {
            op_result: "success",
            world_resp: {
                message: "消息已广播给所有居民",
                content: content
            }
        };
    }

    async waitSomeTime(parameters = { time: 10 }, ctx) {
        const { time } = parameters;
        const waitTime = Math.min(time, 30); // 最大等待30秒
        await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
        return {
            op_result: "success",
            world_resp: {
                message: `等待 ${waitTime} 秒完成`,
                waitedSeconds: waitTime
            }
        };
    }

    async useTool(parameters, ctx) {
        if (!this.sharedWorld) {
            return {
                op_result: "error",
                error: "共享世界不可用"
            };
        }

        const { toolEntityId, targetEntityId } = parameters;
        const toolEntity = this.sharedWorld.getEntity(toolEntityId);
        const targetEntity = this.sharedWorld.getEntity(targetEntityId);

        if (!toolEntity) {
            return {
                op_result: "error",
                error: `工具实体不存在: ${toolEntityId}`
            };
        }
        if (!targetEntity) {
            return {
                op_result: "error",
                error: `目标实体不存在: ${targetEntityId}`
            };
        }

        // 检查工具使用权
        if (!this.canUseEntity(toolEntity, ctx.agentId)) {
            return {
                op_result: "error",
                error: `无法使用工具：工具被 ${toolEntity.ownedBy} 拥有`
            };
        }

        // 检查目标使用权
        if (!this.canUseEntity(targetEntity, ctx.agentId)) {
            return {
                op_result: "error",
                error: `无法操作目标：目标被 ${targetEntity.ownedBy} 拥有`
            };
        }

        const toolType = toolEntity.data?.type;
        const targetType = targetEntity.data?.type;
        const toolFunction = toolEntity.data?.function;

        console.log(`使用工具: ${toolType}(${toolFunction}) -> ${targetType}`);

        // 根据工具和目标类型执行动作
        let result;
        if (toolType === 'tool' && toolFunction === 'cut_food' && targetType === 'food') {
            // 用刀切食物
            const slicedFoodId = `sliced_${targetEntityId}_${Date.now()}`;
            const newFoodEntity = {
                eid: slicedFoodId,
                type: 'food',
                data: {
                    name: `切好的${targetEntity.data.name}`,
                    description: `被处理过的${targetEntity.data.name}，可以直接食用`,
                    hungerValue: (targetEntity.data.hungerValue || 0) + 10,
                    state: 'processed',
                    originalEntity: targetEntityId,
                    type: 'food'
                },
                createdBy: ctx.agentId,
                ownedBy: ctx.agentId,
                location: targetEntity.location
            };

            this.sharedWorld.registerEntity(newFoodEntity);

            result = {
                op_result: "success",
                world_resp: {
                    message: `使用${toolEntity.data.name}处理${targetEntity.data.name}，创建了新的食物实体: ${slicedFoodId}`,
                    newEntityId: slicedFoodId,
                    action: 'food_preparation',
                    ownedBy: ctx.agentId
                }
            };
        } else if (toolType === 'tool' && toolFunction === 'water' && targetType === 'plant') {
            // 浇水工具用于植物
            targetEntity.data.waterLevel = (targetEntity.data.waterLevel || 0) + 25;
            targetEntity.data.health = Math.min(100, (targetEntity.data.health || 0) + 15);
            targetEntity.data.lastCared = new Date().toISOString();

            // 如果植物生长状态改变
            if (targetEntity.data.waterLevel > 50 && targetEntity.data.growthState === 'seed') {
                targetEntity.data.growthState = 'sprout';
            } else if (targetEntity.data.waterLevel > 80 && targetEntity.data.growthState === 'sprout') {
                targetEntity.data.growthState = 'mature';
            }

            this.sharedWorld.updateEntity(targetEntityId, targetEntity);

            result = {
                op_result: "success",
                world_resp: {
                    message: `使用${toolEntity.data.name}照顾植物，植物状态改善`,
                    updatedEntity: targetEntity,
                    action: 'plant_care',
                    waterLevel: targetEntity.data.waterLevel,
                    health: targetEntity.data.health,
                    growthState: targetEntity.data.growthState
                }
            };
        } else {
            result = {
                op_result: "error",
                error: `工具 ${toolFunction} 不能用于目标 ${targetType}`
            };
        }

        return result;
    }

    async moveTo(parameters, ctx) {
        const { location } = parameters;
        const validLocations = ['kitchen', 'bedroom', 'garden'];

        if (!validLocations.includes(location)) {
            return {
                op_result: "error",
                error: `无效的位置: ${location}。有效位置: ${validLocations.join(', ')}`
            };
        }

        // 探索新位置的实体
        const locationEntities = this.sharedWorld.getEntitiesByLocation(location) || [];
        const discoverableEntities = locationEntities.slice(0, 3).map(e => ({
            eid: e.eid,
            type: e.data?.type || 'unknown',
            name: e.data?.name || '未命名'
        }));

        return {
            op_result: "success",
            world_resp: {
                message: `移动到 ${location} 区域`,
                currentLocation: location,
                discoveredEntities: discoverableEntities,
                totalEntitiesInLocation: locationEntities.length,
                timestamp: new Date().toISOString()
            }
        };
    }

    async rest(parameters, ctx) {
        if (!this.sharedWorld) {
            return {
                op_result: "error",
                error: "共享世界不可用"
            };
        }

        const { furnitureEntityId } = parameters;
        const furnitureEntity = this.sharedWorld.getEntity(furnitureEntityId);

        if (!furnitureEntity) {
            return {
                op_result: "error",
                error: `家具实体不存在: ${furnitureEntityId}`
            };
        }

        const furnitureType = furnitureEntity.data?.type;
        const furnitureFunction = furnitureEntity.data?.function;

        if (furnitureType !== 'furniture' || furnitureFunction !== 'rest') {
            return {
                op_result: "error",
                error: `该实体不是用于休息的家具`
            };
        }

        // 检查使用权
        if (!this.canUseEntity(furnitureEntity, ctx.agentId)) {
            return {
                op_result: "error",
                error: `无法使用：家具被 ${furnitureEntity.ownedBy} 拥有`
            };
        }

        // 模拟休息效果
        const energyRestored = furnitureEntity.data.comfort || 25;
        const restDuration = Math.floor(Math.random() * 10) + 10; // 10-20秒

        // 等待休息时间
        await new Promise(resolve => setTimeout(resolve, restDuration * 1000));

        return {
            op_result: "success",
            world_resp: {
                message: `使用${furnitureEntity.data.name}休息了${restDuration}秒，恢复了${energyRestored}点精力`,
                energyRestored: energyRestored,
                duration: restDuration,
                furniture: furnitureEntity.data.name,
                comfortLevel: furnitureEntity.data.comfort
            }
        };
    }
}

// 创建执行器函数
function createUtilsToolkit(config = {}) {
    const toolkit = new UtilsToolkit(config);
    return async (toolName, parameters, ctx) => {
        return await toolkit.execute(toolName, parameters, ctx);
    };
}

module.exports = createUtilsToolkit;
