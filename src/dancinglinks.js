/*
    Implementation of Donald Knuth's DancingLinks technique for solving the exact cover problem.
    See https://en.wikipedia.org/wiki/Dancing_Links
*/
class Node {
    constructor(value, left = this) {
        this.value = value;
        this.left = left;
        this.right = this.up = this.down = this;
    }

    insertBelow(up) {
        this.up = up;
        this.down = up.down;
        up.down.up = up.down = this;
        this.column = up.column;
        ++this.column.rowCount;
    }

    removeVertically() {
        this.up.down = this.down;
        this.down.up = this.up;
        --this.column.rowCount;
    }

    reinsertVertically() {
        this.up.down = this.down.up = this;
        ++this.column.rowCount;
    }

    removeHorizontally() {
        this.left.right = this.right;
        this.right.left = this.left;
    }

    reinsertHorizontally() {
        this.left.right = this.right.left = this;
    }
}

class Column extends Node {
    constructor(value, left) {
        super(value, left);
        this.rowCount = 0;
        this.column = this;
    }
}

const cover = node => {
    const column = node.column;
    column.removeHorizontally();
    for (let row = column.down; row !== column; row = row.down) {
        --column.header.rowCount;
        for (let peer = row.right; peer !== row; peer = peer.right) {
            peer.removeVertically();
        }
    }
};

const uncover = node => {
    const column = node.column;
    for (let row = column.up; row !== column; row = row.up) {
        for (let peer = row.left; peer !== row; peer = peer.left) {
            peer.reinsertVertically();
        }
        ++column.header.rowCount;
    }
    column.reinsertHorizontally();
};

const selectColumn = columns => {
    let minColumn;
    for (let column = columns.right; column !== columns; column = column.right) {
        if (column.rowCount === 0) {
            return column;
        }
        if (!minColumn || column.rowCount < minColumn.rowCount) {
            minColumn = column;
        }
    }
    return minColumn;
};

export function* solve(options, givenOptions = []) {
    const items = [...new Set(Object.values(options).flat())];
    const columns = new Column('columns');
    const columnsByItem = new Map();
    const maxYieldIntervalMs = 50;

    const createColumn = (left, item) => {
        const column = new Column(item, left);
        columnsByItem.set(column.value, column);
        column.header = columns;
        return left.right = column;
    };

    // build horizontally connected column header nodes
    columns.left = items.reduce(createColumn, columns);
    columns.left.right = columns;

    const rowsByOption = new Map();
    for (const [option, items] of Object.entries(options)) {
        const rowHeader = new Node();

        const createRow = (left, item) => {
            const row = new Node(item, left);
            const column = columnsByItem.get(row.value);
            // insert each row node vertically into it's corresponding column
            row.insertBelow(column.up);
            row.option = option;
            return left.right = row;
        };

        // build horizontally connected row of nodes
        rowHeader.left = items.reduce(createRow, rowHeader);
        rowHeader.left.right = rowHeader;

        rowsByOption.set(option, rowHeader.right);
        rowHeader.removeHorizontally();
        ++columns.rowCount;
    }

    const columnContains = (column, row) => {
        for (let peer = column.down; peer !== column; peer = peer.down) {
            if (peer === row) {
                return true;
            }
        }
    };

    const solution = [];
    for (const option of givenOptions) {
        const row = rowsByOption.get(option);
        if (row && columnContains(row.column, row)) {
            cover(row);
            for (let peer = row.right; peer !== row; peer = peer.right) {
                cover(peer);
            }
            solution.push(row.option);
            rowsByOption.delete(option);
        } else {
            // given option is impossible
            return;
        }
    }

    let lastYieldMs = Date.now();
    
    function* search() {
        const now = Date.now();
        const column = selectColumn(columns);

        if (!column) {
            // all requirements have been met, yield a solution
            yield [...solution];
            lastYieldMs = now;
            return;
        } 
        
        if (column.rowCount === 0) {
            // an unfulfilled requirement cannot be satisfied with remaining options ... dead end, backtrack
            return;
        }

        if (now - lastYieldMs > maxYieldIntervalMs) {
            // periodically relinquish control back to caller without a solution
            yield;
            lastYieldMs = now;
        }

        // try satisfying the requirement represented by column
        cover(column);
        for (let row = column.down; row !== column; row = row.down) {
            solution.push(row.option);
            
            for (let peer = row.right; peer !== row; peer = peer.right) {
                cover(peer);
            }

            yield* search();
            
            for (let peer = row.left; peer !== row; peer = peer.left) {
                uncover(peer);
            }
            
            solution.pop();
        }
        uncover(column);
    }

    yield* search();
}
