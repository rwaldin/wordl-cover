import { solve } from './dancinglinks.js';

addEventListener('message', msg => {
    if (msg.data.type === 'solve') {
        for (const solution of solve(msg.data.options)) {
            if (solution) {
                postMessage({ type: 'solution', solution });
            }
        }
        postMessage({ type: 'completed' });
    }
});
