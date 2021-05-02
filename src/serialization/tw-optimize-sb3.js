/**
 * Copyright (C) 2021 Thomas Weber
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

const SOUP = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#%()*+,-./:;=?@[]^_`{|}~';
const generateId = i => {
    // Certain IDs already have other meanings, so we will skip these
    if (i > 1309) i++; // of
    // There are some other ones that have meaning (Object.keys(vm.runtime.monitorBlocks._blocks)),
    // but these would take an unreasonably large amount of items to hit, so we don't bother listing them here.
    let str = '';
    while (i >= 0) {
        str = SOUP[i % SOUP.length] + str;
        i = Math.floor(i / SOUP.length) - 1;
    }
    return str;
};

class Pool {
    constructor () {
        this.generatedIds = new Map();
        this.references = new Map();
    }
    addReference (id) {
        const currentCount = this.references.get(id) || 0;
        this.references.set(id, currentCount + 1);
    }
    generateNewIds () {
        const entries = Array.from(this.references.entries());
        // Sort descending by count.
        // The most used original IDs should get the shortest new IDs.
        entries.sort((a, b) => b[1] - a[1]);
        for (let i = 0; i < entries.length; i++) {
            this.generatedIds.set(entries[i][0], generateId(i));
        }
    }
    getNewId (originalId) {
        if (this.generatedIds.has(originalId)) {
            return this.generatedIds.get(originalId);
        }
        return originalId;
    }
}

const optimize = projectData => {
    // Scan the project and find all IDs and how often they're used
    const targetPools = new Map();
    const variablePool = new Pool();
    // monitors has to be converted to an array
    projectData.monitors = Array.from(projectData.monitors);
    for (const monitor of projectData.monitors) {
        const monitorOpcode = monitor.opcode;
        if (monitorOpcode === 'data_variable' || monitorOpcode === 'data_listcontents') {
            const monitorId = monitor.id;
            variablePool.addReference(monitorId);
        }
    }
    for (const target of projectData.targets) {
        const blockPool = new Pool();
        const commentPool = new Pool();
        targetPools.set(target, {
            blockPool,
            commentPool
        });

        const handleCompressedNative = native => {
            const type = native[0];
            if (type === /* VAR_PRIMITIVE */ 12 || type === /* LIST_PRIMITIVE */ 13) {
                const variableId = native[2];
                variablePool.addReference(variableId);
            } else if (type === /* BROADCAST_PRIMITIVE */ 11) {
                const broadcastId = native[2];
                variablePool.addReference(broadcastId);
            }
        };

        for (const variableId of Object.keys(target.variables)) {
            variablePool.addReference(variableId);
        }
        for (const variableId of Object.keys(target.lists)) {
            variablePool.addReference(variableId);
        }
        for (const broadcastId of Object.keys(target.broadcasts)) {
            variablePool.addReference(broadcastId);
        }
        for (const blockId of Object.keys(target.blocks)) {
            const block = target.blocks[blockId];
            blockPool.addReference(blockId);
            if (Array.isArray(block)) {
                handleCompressedNative(block);
                continue;
            }
            if (block.parent) {
                blockPool.addReference(block.parent);
            }
            if (block.next) {
                blockPool.addReference(block.next);
            }
            if (block.comment) {
                commentPool.addReference(block.comment);
            }
            if (block.fields.VARIABLE) {
                variablePool.addReference(block.fields.VARIABLE[1]);
            }
            if (block.fields.LIST) {
                variablePool.addReference(block.fields.LIST[1]);
            }
            if (block.fields.BROADCAST_OPTION) {
                variablePool.addReference(block.fields.BROADCAST_OPTION[1]);
            }
            for (const inputName of Object.keys(block.inputs)) {
                const input = block.inputs[inputName];
                const inputValue = input[1];
                if (Array.isArray(inputValue)) {
                    handleCompressedNative(inputValue);
                } else if (typeof inputValue === 'string') {
                    const childBlockId = input[1];
                    blockPool.addReference(childBlockId);
                }
            }
        }
        for (const commentId of Object.keys(target.comments)) {
            const comment = target.comments[commentId];
            commentPool.addReference(commentId);
            if (comment.blockId) {
                blockPool.addReference(comment.blockId);
            }
        }
    }

    // Used the data from the first scan to replace all the IDs with shorter versions
    variablePool.generateNewIds();
    for (const monitor of projectData.monitors) {
        const monitorOpcode = monitor.opcode;
        if (monitorOpcode === 'data_variable' || monitorOpcode === 'data_listcontents') {
            const monitorId = monitor.id;
            monitor.id = variablePool.getNewId(monitorId);
        }
    }
    for (const [target, {blockPool, commentPool}] of targetPools.entries()) {
        blockPool.generateNewIds();
        commentPool.generateNewIds();

        const newVariables = {};
        const newLists = {};
        const newBroadcasts = {};
        const newBlocks = {};
        const newComments = {};

        const handleCompressedNative = native => {
            const type = native[0];
            if (type === /* VAR_PRIMITIVE */ 12 || type === /* LIST_PRIMITIVE */ 13) {
                const variableId = native[2];
                native[2] = variablePool.getNewId(variableId);
            } else if (type === /* BROADCAST_PRIMITIVE */ 11) {
                const broadcastId = native[2];
                native[2] = variablePool.getNewId(broadcastId);
            }
        };

        for (const variableId of Object.keys(target.variables)) {
            const variable = target.variables[variableId];
            newVariables[variablePool.getNewId(variableId)] = variable;
        }
        for (const variableId of Object.keys(target.lists)) {
            const variable = target.lists[variableId];
            newLists[variablePool.getNewId(variableId)] = variable;
        }
        for (const broadcastId of Object.keys(target.broadcasts)) {
            const broadcast = target.broadcasts[broadcastId];
            newBroadcasts[variablePool.getNewId(broadcastId)] = broadcast;
        }
        for (const blockId of Object.keys(target.blocks)) {
            const block = target.blocks[blockId];
            newBlocks[blockPool.getNewId(blockId)] = block;
            if (Array.isArray(block)) {
                handleCompressedNative(block);
                continue;
            }
            if (block.parent) {
                block.parent = blockPool.getNewId(block.parent);
            }
            if (block.next) {
                block.next = blockPool.getNewId(block.next);
            }
            if (block.comment) {
                block.comment = commentPool.getNewId(block.comment);
            }
            if (block.fields.VARIABLE) {
                block.fields.VARIABLE[1] = variablePool.getNewId(block.fields.VARIABLE[1]);
            }
            if (block.fields.LIST) {
                block.fields.LIST[1] = variablePool.getNewId(block.fields.LIST[1]);
            }
            if (block.fields.BROADCAST_OPTION) {
                block.fields.BROADCAST_OPTION[1] = variablePool.getNewId(block.fields.BROADCAST_OPTION[1]);
            }
            for (const inputName of Object.keys(block.inputs)) {
                const input = block.inputs[inputName];
                const inputValue = input[1];
                if (Array.isArray(inputValue)) {
                    handleCompressedNative(inputValue);
                } else if (typeof inputValue === 'string') {
                    const childBlockId = input[1];
                    input[1] = blockPool.getNewId(childBlockId);
                }
            }
            if (block.opcode === 'procedures_call' || block.opcode === 'procedures_prototype') {
                const argumentIds = JSON.parse(block.mutation.argumentids);
                const newArgumentIds = [];
                const newInputs = {};
                for (let i = 0; i < argumentIds.length; i++) {
                    const newArgumentId = generateId(i);
                    const originalArgumentId = argumentIds[i];
                    const argumentInput = block.inputs[originalArgumentId];
                    if (argumentInput) {
                        newInputs[newArgumentId] = argumentInput;
                    }
                    newArgumentIds.push(newArgumentId);
                }
                block.inputs = newInputs;
                block.mutation.argumentids = JSON.stringify(newArgumentIds);
            }
        }
        for (const commentId of Object.keys(target.comments)) {
            const comment = target.comments[commentId];
            newComments[commentPool.getNewId(commentId)] = comment;
            if (comment.blockId) {
                comment.blockId = blockPool.getNewId(comment.blockId);
            }
        }

        target.variables = newVariables;
        target.lists = newLists;
        target.broadcasts = newBroadcasts;
        target.blocks = newBlocks;
        target.comments = newComments;
    }
};

module.exports = optimize;
