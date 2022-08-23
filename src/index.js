const ios = /iPad|iPhone/.test(navigator.userAgent);
const availableConcurrency = 'hardwareConcurrency' in navigator ? navigator.hardwareConcurrency : ios ? 2 : 8;

// 9 extra spaces in the worker url allow replacement of url with hashed url without affecting sourcemap locations
const workers = Array.from({ length: availableConcurrency }, _ => new Worker('./worker.js         ')); 
const numberFormatter = new Intl.NumberFormat();
const formatNumber = number => numberFormatter.format(number);
const formatSeconds = number => `${formatNumber(number)} seconds`;
const crlfRegex = /\r?\n/;

const { solutionsElem, solveForm, outputForm } = window;

const {
    customWordFile: customWordFileInput,
    solveButton: solveButton,
    concurrency: concurrencyElem,
    wordList: wordListRadio,
} = solveForm;

const {
    wordCount: wordCountElem,
    fiveLetterWordCount: fiveLetterWordCountElem,
    normalizedWordCount: normalizedWordCountElem,
    solutionCount: solutionCountElem,
    elapsedTime: elapsedTimeElem,
    workItems: workItemsElem,
    workersWorking: workersWorkingElem,
} = outputForm;

const customWordListElem = [...wordListRadio].find(({ value }) => value === 'custom');
const wordlListElem = [...wordListRadio].find(({ value }) => /wordl/.test(value));
const wordsAlphaListElem = [...wordListRadio].find(({ value }) => /words_alpha/.test(value));

for (let n = 0; n < availableConcurrency; ++n) {
    concurrencyElem.appendChild(document.createElement('option')).append(n + 1);
}
concurrencyElem.value = availableConcurrency;

customWordFileInput.addEventListener('change', _ => (wordListRadio.value = 'custom'));
customWordListElem.addEventListener('change', _ => {
    if (wordListRadio.value === 'custom' && !customWordFileInput.value) {
        customWordFileInput.click();
    }
});

const splitWordsString = wordsString => {
    if (Array.isArray(wordsString)) {
        // intersect word lists
        const [list1, list2] = wordsString.map(str => str.split(crlfRegex).map(word => word.trim().toLowerCase()));
        const set = new Set(list1);
        return list2.filter(word => set.has(word));
    } else {
        return wordsString.split(crlfRegex).map(word => word.trim().toLowerCase());
    }
};

const solve = wordsString => {
    const startTime = Date.now();

    solutionsElem.innerHTML = '';
    solveButton.innerText = 'Solving...';
    solutionCountElem.innerText = 0;

    const allWords = splitWordsString(wordsString);
    wordCountElem.innerText = formatNumber(allWords.length);

    const fiveLetterWords = allWords.filter(word => /^[a-z]{5}$/.test(word));
    fiveLetterWordCountElem.innerText = formatNumber(fiveLetterWords.length);

    // normalizedWords are fiveLetterWords with their letters rearranged so that they are sorted (WORDS becomes DORSW).
    // Anagrams are removed from consideration by searching for normalizedWords instead of actual words since all anagrams
    // map to the same normalizedWord.  Normalized words with any repeating characters are also removed.
    const normalizedWordMap = new Map();
    for (const word of fiveLetterWords) {
        const normalizedWord = [...new Set(word)].sort().join('');
        // ignore normalized words with repeating characters
        if (normalizedWord.length === 5) {
            const entry = normalizedWordMap.get(normalizedWord);
            // combine anagrams for display later
            normalizedWordMap.set(normalizedWord, entry ? `${entry}/${word}` : word);
        }
    }
    normalizedWordCountElem.innerText = formatNumber(normalizedWordMap.size);

    const words = [...normalizedWordMap.keys()];
    const options = Object.fromEntries(words.map(word => [word, word.split('')]));

    const a = 'a'.charCodeAt(0);
    const allChars = Array.from({ length: 26 }, (_, i) => String.fromCharCode(a + i));
    
    const usedChars = new Set(Object.values(options).flat());
    if (usedChars.size !== allChars.length) {
        const missingChars = allChars.filter(char => !usedChars.has(char));
        solutionsElem.appendChild(document.createElement('li')).append(`Invalid word list. Missing letters: ${missingChars.join(', ')}`);
        return;
    }

    const solutions = new Set();
    const displaySolutions = [];

    const workItems = allChars
        .map(char => Object.fromEntries(Object.entries(options).filter(([word]) => !word.includes(char))))
        // sort work in descending order of option count to reduce the time long-pole dangling workers require
        .sort((workItem1, workItem2) => Object.keys(workItem2).length - Object.keys(workItem1).length);

    const recordSolution = solution => {
        // ignore solutions that contain the same normalized words as an already recorded solution, but in a different order
        const normalizedSolution = solution.sort().join(',');
        if (!solutions.has(normalizedSolution)) {
            solutions.add(normalizedSolution);
            displaySolutions.push(
                normalizedSolution
                    .split(',')
                    .map(step => normalizedWordMap.get(step))
                    .sort()
                    .join(', ')
            );
        }
    };

    let currentWorkItem = 0;
    let completedWorkItems = 0;

    const renderInterval = setInterval(requestAnimationFrame, 60, _ => {
        // append list elements for newly arrived solutions since last render
        for (let i = solutionsElem.children.length; i < displaySolutions.length; ++i) {
            solutionsElem.appendChild(document.createElement('li')).append(displaySolutions[i]);
        }
        solutionsElem.scrollTop = solutionsElem.scrollHeight;
        solutionCountElem.innerText = formatNumber(solutions.size);
        workItemsElem.value = workItems.length - completedWorkItems;
        elapsedTimeElem.innerText = formatSeconds((Date.now() - startTime) / 1000);
    });

    return new Promise(resolve => {
        for (const [n, worker] of workers.entries()) {
            if (n >= concurrencyElem.value) {
                break;
            }

            const messageHandler = msg => {
                switch (msg.data.type) {
                    case 'solution': {
                        recordSolution(msg.data.solution);
                        break;
                    }

                    case 'completed': {
                        ++completedWorkItems;
                        if (currentWorkItem < workItems.length) {
                            worker.postMessage({ type: 'solve', options: workItems[currentWorkItem++] });
                        } else {
                            workersWorkingElem.value -= 1;
                            worker.removeEventListener('message', messageHandler);

                            if (completedWorkItems === workItems.length) {
                                solveButton.disabled = false;
                                solveButton.innerText = 'Solve';
                                elapsedTimeElem.innerText = formatSeconds((Date.now() - startTime) / 1000);
                                workItemsElem.value = 0;
                                clearInterval(renderInterval);
                                resolve();
                            }
                        }
                        break;
                    }
                }
            };

            if (currentWorkItem < workItems.length) {
                workersWorkingElem.value = n + 1;
                worker.addEventListener('message', messageHandler);
                worker.postMessage({ type: 'solve', options: workItems[currentWorkItem++] });
            }
        }
    });
};

const loadWords = url => fetch(url).then(response => response.text());
const fileReader = new FileReader();
fileReader.addEventListener('load', async evt => await solve(evt.target.result));

solveButton.addEventListener('click', async evt => {
    evt.preventDefault();
    solveButton.disabled = true;
    solveButton.innerText = 'Loading...';

    switch (wordListRadio.value) {
        case 'custom': {
            fileReader.readAsText(customWordFileInput.files[0]);
            break;
        }
        case 'intersection': {
            await solve(await Promise.all([loadWords(wordlListElem.value), loadWords(wordsAlphaListElem.value)]));
            break;
        }
        default: {
            await solve(await loadWords(wordListRadio.value));
            break;
        }
    }
});

if (location.hostname === 'waldin.net') {
    const params = new URLSearchParams({
        nc: Date.now(),
        code: '840xigs5jBlPzxN77diWdugPDGjroC6y',
        url: location.href,
        t: document.title,
        ref: document.referrer,
        w: screen.width,
        h: screen.height,
    });
    fetch(`https://api.pirsch.io/hit?${params}`);
}
