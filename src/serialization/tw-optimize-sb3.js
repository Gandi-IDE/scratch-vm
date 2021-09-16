/**
 * Copyright (C) 2021 Thomas Weber
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License version 3
 * as published by the Free Software Foundation.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

const SOUP = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#%()*+,-./:;=?@[]^_`{|}~';
const generateId = i => {
    // IDs in Object.keys(vm.runtime.monitorBlocks._blocks) already have meaning, so make sure to skip those
    // We don't bother listing many here because most would take more than ten million items to be used
    if (i > 1309) i++; // of
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
    // projectData is modified in-place

    // The optimization here is not optimal. This is intentional because we want to be truly lossless and maintain
    // all editor functionality and compatibility with third-party tools.

    // Optimization happens in two "passes", one to find all IDs and sort them so that we can generate the most
    // optimized new IDs, then one more pass to actually apply those new IDs.
    const pool = new Pool();

    for (const target of projectData.targets) {
        for (const blockId of Object.keys(target.blocks)) {
            const block = target.blocks[blockId];
            pool.addReference(blockId);
            if (Array.isArray(block)) {
                // Compressed primitive
                continue;
            }
            if (block.parent) {
                pool.addReference(block.parent);
            }
            if (block.next) {
                pool.addReference(block.next);
            }
            if (block.comment) {
                pool.addReference(block.comment);
            }
            for (const inputName of Object.keys(block.inputs)) {
                const input = block.inputs[inputName];
                const inputValue = input[1];
                if (typeof inputValue === 'string') {
                    const childBlockId = input[1];
                    pool.addReference(childBlockId);
                }
            }
        }
        for (const commentId of Object.keys(target.comments)) {
            const comment = target.comments[commentId];
            pool.addReference(commentId);
            if (comment.blockId) {
                pool.addReference(comment.blockId);
            }
        }
    }

    pool.generateNewIds();
    for (const target of projectData.targets) {
        const newBlocks = {};
        const newComments = {};
        for (const blockId of Object.keys(target.blocks)) {
            const block = target.blocks[blockId];
            newBlocks[pool.getNewId(blockId)] = block;
            if (Array.isArray(block)) {
                continue;
            }
            if (block.parent) {
                block.parent = pool.getNewId(block.parent);
            }
            if (block.next) {
                block.next = pool.getNewId(block.next);
            }
            if (block.comment) {
                block.comment = pool.getNewId(block.comment);
            }
            for (const inputName of Object.keys(block.inputs)) {
                const input = block.inputs[inputName];
                const inputValue = input[1];
                if (typeof inputValue === 'string') {
                    const childBlockId = input[1];
                    input[1] = pool.getNewId(childBlockId);
                }
            }
        }
        for (const commentId of Object.keys(target.comments)) {
            const comment = target.comments[commentId];
            newComments[pool.getNewId(commentId)] = comment;
            if (comment.blockId) {
                comment.blockId = pool.getNewId(comment.blockId);
            }
        }
        target.blocks = newBlocks;
        target.comments = newComments;
    }
};

module.exports = optimize;
