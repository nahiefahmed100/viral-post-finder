// Remote Github License URL
const LICENSE_URL = "https://gist.githubusercontent.com/nayeemgaming17-arch/f4d9fd95070e4f95c26e0e7b7a9e5bcf/raw/users.txt";

// Initialization: Generate/Load PC ID and display it, and load saved settings
document.addEventListener("DOMContentLoaded", () => {
    // Load PC ID
    chrome.storage.local.get(['pcId', 'minComments', 'range1min', 'range1max', 'range2min', 'range2max', 'detectionMethod'], function(result) {
        let pcId = result.pcId;
        if (!pcId) {
            pcId = Math.random().toString(36).substring(2, 11).toUpperCase();
            chrome.storage.local.set({ pcId: pcId });
        }
        document.getElementById("pcIdDisplay").value = pcId;

        // Load other settings
        if (result.minComments !== undefined) document.getElementById("minComments").value = result.minComments;
        if (result.range1min !== undefined) document.getElementById("range1min").value = result.range1min;
        if (result.range1max !== undefined) document.getElementById("range1max").value = result.range1max;
        if (result.range2min !== undefined) document.getElementById("range2min").value = result.range2min;
        if (result.range2max !== undefined) document.getElementById("range2max").value = result.range2max;
        if (result.detectionMethod !== undefined) document.getElementById("detectionMethod").value = result.detectionMethod;

        // Populate initial Active Settings display
        updateConfigDisplay();
    });

    document.getElementById("copyIdBtn").onclick = () => {
        const idField = document.getElementById("pcIdDisplay");
        idField.select();
        document.execCommand("copy");
        document.getElementById("copyIdBtn").innerText = "Copied!";
        setTimeout(() => { document.getElementById("copyIdBtn").innerText = "Copy"; }, 2000);
    };

    // Auto-save settings on input
    const inputs = ['minComments', 'range1min', 'range1max', 'range2min', 'range2max', 'detectionMethod'];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        el.addEventListener('input', () => {
            const val = el.value;
            chrome.storage.local.set({ [id]: val });
            updateConfigDisplay();
        });
    });
});

function updateConfigDisplay() {
    const min = document.getElementById("minComments").value;
    const r1min = document.getElementById("range1min").value;
    const r1max = document.getElementById("range1max").value;
    const r2min = document.getElementById("range2min").value;
    const r2max = document.getElementById("range2max").value;
    const detectionMethod = document.getElementById("detectionMethod").value;

    document.getElementById("scanInfo1").innerText = `Main: Min ${min} (${detectionMethod.toUpperCase()})`;
    document.getElementById("scanInfo2").innerText = `Range 1: ${r1min || '*'} to ${r1max || '*'}`;
    document.getElementById("scanInfo3").innerText = `Range 2: ${r2min || '*'} to ${r2max || '*'}`;
}

document.getElementById("find").onclick = async () => {

    const minRaw = document.getElementById("minComments").value;
    const min = parseInt(minRaw) || 0;
    
    // Range 1
    const r1minRaw = document.getElementById("range1min").value;
    const r1min = r1minRaw ? parseInt(r1minRaw) : null;
    const r1maxRaw = document.getElementById("range1max").value;
    const r1max = r1maxRaw ? parseInt(r1maxRaw) : null;

    // Range 2
    const r2minRaw = document.getElementById("range2min").value;
    const r2min = r2minRaw ? parseInt(r2minRaw) : null;
    const r2maxRaw = document.getElementById("range2max").value;
    const r2max = r2maxRaw ? parseInt(r2maxRaw) : null;

    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    if (!tab) {
        alert("Error: No active tab found.");
        return;
    }

    const detectionMethod = document.getElementById("detectionMethod").value;
    
    document.getElementById("status").innerText = "Checking License...";

    // 1. Get local PC ID
    const storageResult = await chrome.storage.local.get(['pcId']);
    const pcId = storageResult.pcId;

    if (!pcId) {
        alert("Error: PC ID not found. Please reload the extension.");
        return;
    }

    // 2. Fetch remote license list
    try {
        const response = await fetch(LICENSE_URL + "?t=" + new Date().getTime()); // Prevent caching
        if (!response.ok) throw new Error("Could not connect to license server.");
        
        const text = await response.text();
        const allowedIds = text.split('\n')
                               .map(line => line.split(/[ \t]+/)[0].trim())
                               .filter(id => id.length > 0);

        // 3. Check if PC ID is in the list
        if (!allowedIds.includes(pcId)) {
            document.getElementById("status").innerText = "Status: Unauthorized PC.";
            alert(`Your PC ID (${pcId}) is not authorized. Please send your ID to the admin to get access.`);
            return;
        }

    } catch (e) {
        document.getElementById("status").innerText = "Status: License Check Failed.";
        alert("License check failed: " + e.message + "\nPlease check your internet connection.");
        return;
    }

    document.getElementById("status").innerText = "Running...";
    
    // Update local config display (New UI uses innerText)
    updateConfigDisplay();

    chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [min, r1min, r1max, r2min, r2max, detectionMethod],
        func: startScan
    }, () => {
        if (chrome.runtime.lastError) {
            document.getElementById("status").innerText = "Error: " + chrome.runtime.lastError.message;
        }
    });
};

document.getElementById("stop").onclick = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            chrome.tabs.reload(tabs[0].id);
        }
    });
};

document.getElementById("copy").onclick = () => {
    let t = document.getElementById("result");
    t.select();
    document.execCommand("copy");
    document.getElementById("copy").innerText = "Copied!";
    setTimeout(() => {
        document.getElementById("copy").innerText = "Copy All Links";
    }, 2000);
};


function startScan(min, r1min, r1max, r2min, r2max, detectionMethod) {

    // --- STATE VARIABLES ---
    let running = true;
    let paused = false;
    let scrollDelay = 800; // Made faster and smoother
    
    // Timer State
    let startTime = Date.now();
    let elapsedSeconds = 0;
    let timerInterval = null;
    let lastFoundYear = new Date().getFullYear().toString();
    
    function formatTime(totalSeconds) {
        let m = Math.floor(totalSeconds / 60);
        let s = totalSeconds % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    // Build valid conditions array
    let conditions = [];
    
    // Main Condition: strictly greater than or equal to min
    conditions.push({ isMain: true, min: min, max: null, collected: new Set() });

    // Range 1
    if (r1min !== null || r1max !== null) {
        conditions.push({ min: r1min, max: r1max, collected: new Set() });
    }

    // Range 2
    if (r2min !== null || r2max !== null) {
        conditions.push({ min: r2min, max: r2max, collected: new Set() });
    }

    // --- UI SETUP ---
    if (document.getElementById('viral-ui')) document.getElementById('viral-ui').remove();

    let box = document.createElement('div');
    box.id = 'viral-ui';
    box.style.position = 'fixed';
    box.style.top = '10%';
    box.style.right = '10px';
    box.style.width = '320px';
    box.style.height = 'auto';
    box.style.maxHeight = '600px';
    box.style.background = 'white';
    box.style.border = '2px solid black';
    box.style.zIndex = '99999999';
    box.style.padding = '15px';
    box.style.boxShadow = '0 0 15px rgba(0,0,0,0.5)';
    box.style.display = 'flex';
    box.style.flexDirection = 'column';
    box.style.fontFamily = 'Arial, sans-serif';
    box.style.borderRadius = '8px';

    let title = document.createElement('h3');
    title.innerText = `Scanning... (00:00) | Year: ${lastFoundYear} | Total: 0`;
    title.style.marginTop = '0';
    title.style.marginBottom = '5px';
    title.style.color = '#333';
    title.style.fontSize = '14px'; // Slightly smaller to fit
    title.style.fontWeight = 'bold';
    box.appendChild(title);
    
    // Start Timer
    timerInterval = setInterval(() => {
        if (!paused && running) {
            elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
            title.innerText = `Scanning... (${formatTime(elapsedSeconds)}) | Yr: ${lastFoundYear} | Total: ${getTotalFound()}`;
        }
    }, 1000);
    
    // Config Info Box
    let configDiv = document.createElement('div');
    configDiv.style.marginBottom = '10px';
    configDiv.style.display = 'flex';
    configDiv.style.flexDirection = 'column';
    configDiv.style.gap = '3px';
    
    function createInfoPill(text) {
        let pill = document.createElement('div');
        pill.innerText = text;
        pill.style.background = '#e8f4f8';
        pill.style.padding = '5px';
        pill.style.borderRadius = '4px';
        pill.style.fontSize = '11px';
        pill.style.textAlign = 'center';
        pill.style.fontWeight = 'bold';
        pill.style.color = '#2980b9';
        return pill;
    }

    configDiv.appendChild(createInfoPill(`Main: Min ${min}`));
    
    if (r1min !== null || r1max !== null) {
        configDiv.appendChild(createInfoPill(`Range 1: ${r1min !== null ? r1min : '*'} to ${r1max !== null ? r1max : '*'}`));
    }
    
    if (r2min !== null || r2max !== null) {
        configDiv.appendChild(createInfoPill(`Range 2: ${r2min !== null ? r2min : '*'} to ${r2max !== null ? r2max : '*'}`));
    }
    
    box.appendChild(configDiv);

    // --- CONTROLS AREA ---
    let controlsDiv = document.createElement('div');
    controlsDiv.style.marginBottom = '10px';
    controlsDiv.style.padding = '10px';
    controlsDiv.style.background = '#f0f0f0';
    controlsDiv.style.borderRadius = '5px';

    // Speed Control Header Container
    let speedHeaderContainer = document.createElement('div');
    speedHeaderContainer.style.display = 'flex';
    speedHeaderContainer.style.justifyContent = 'space-between';
    speedHeaderContainer.style.alignItems = 'center';
    speedHeaderContainer.style.marginBottom = '5px';

    let speedLabel = document.createElement('div');
    speedLabel.innerText = "Speed Control: Normal";
    speedLabel.style.fontSize = '12px';
    speedLabel.style.fontWeight = 'bold';
    
    // Custom Number Input for Absolute Control
    let speedInput = document.createElement('input');
    speedInput.type = 'number';
    speedInput.min = '10'; // Allows extreme speed (like 20ms or 30ms)
    speedInput.placeholder = 'ms';
    speedInput.title = 'Custom Delay (ms)';
    speedInput.style.width = '45px';
    speedInput.style.fontSize = '11px';
    speedInput.style.padding = '2px';
    speedInput.style.borderRadius = '3px';
    speedInput.style.border = '1px solid #ccc';
    speedInput.style.textAlign = 'center';
    
    speedInput.oninput = () => {
        let customVal = parseInt(speedInput.value);
        if (!isNaN(customVal) && customVal > 0) {
            scrollDelay = customVal;
            speedLabel.innerText = `Control: Custom`;
        }
    };

    speedHeaderContainer.appendChild(speedLabel);
    speedHeaderContainer.appendChild(speedInput);
    controlsDiv.appendChild(speedHeaderContainer);

    let speedContainer = document.createElement('div');
    speedContainer.style.display = 'flex';
    speedContainer.style.alignItems = 'center';
    speedContainer.style.gap = '5px';

    let slowText = document.createElement('span');
    slowText.innerText = "Slow";
    slowText.style.fontSize = '10px';
    speedContainer.appendChild(slowText);

    let speedSlider = document.createElement('input');
    speedSlider.type = 'range';
    // Logic: Left (Slow) -> Right (Fast)
    // Value: 1 (Slowest) -> 10 (Fastest)
    speedSlider.min = '1';
    speedSlider.max = '10';
    speedSlider.value = '5'; // Middle (Normal)
    speedSlider.step = '1';
    speedSlider.style.flex = '1';

    speedSlider.oninput = () => {
        let val = parseInt(speedSlider.value);
        // Map 1-10 to Delay
        // 1 (Slow) = 1000ms
        // 5 (Normal) = 400ms
        // 10 (Fast) = 100ms

        speedInput.value = '';

        if (val === 5) {
            scrollDelay = 400;
            speedLabel.innerText = "Speed Control: Normal";
        } else if (val < 5) {
            // Slower: 400 to 1000
            scrollDelay = 400 + ((5 - val) * 150);
            speedLabel.innerText = "Speed Control: Slower";
        } else {
            // Faster: 400 to 100
            scrollDelay = 400 - ((val - 5) * 60);
            speedLabel.innerText = "Speed Control: Faster";
        }

        if (scrollDelay < 10) scrollDelay = 10;
        if (scrollDelay > 1500) scrollDelay = 1500;
    };
    speedContainer.appendChild(speedSlider);

    let fastText = document.createElement('span');
    fastText.innerText = "Fast";
    fastText.style.fontSize = '10px';
    speedContainer.appendChild(fastText);

    controlsDiv.appendChild(speedContainer);
    box.appendChild(controlsDiv);
    let textareas = [];
    
    // Create UI boxes for each active condition
    conditions.forEach((cond, index) => {
        let scDiv = document.createElement('div');
        scDiv.style.marginBottom = '10px';
        scDiv.style.display = 'flex';
        scDiv.style.flexDirection = 'column';
        
        let header = document.createElement('div');
        header.style.fontSize = '12px';
        header.style.fontWeight = 'bold';
        header.style.marginBottom = '3px';
        
        // Label logic
        if (index === 0) {
            header.innerText = `Main: Min ${cond.min} (Found: 0)`;
        } else if (index === 1) {
            header.innerText = `Range 1: ${cond.min !== null ? cond.min : '*'} to ${cond.max !== null ? cond.max : '*'} (Found: 0)`;
        } else {
            header.innerText = `Range 2: ${cond.min !== null ? cond.min : '*'} to ${cond.max !== null ? cond.max : '*'} (Found: 0)`;
        }
        
        cond.headerEl = header;
        scDiv.appendChild(header);

        let ta = document.createElement('textarea');
        ta.style.width = '100%';
        ta.style.height = '60px'; // Shorter so multiple fit on screen
        ta.style.resize = 'vertical';
        ta.style.padding = '5px';
        ta.style.boxSizing = 'border-box';
        ta.style.border = '1px solid #ccc';
        ta.style.fontSize = '11px';
        ta.setAttribute('readonly', true);
        
        cond.textareaEl = ta;
        textareas.push(ta);
        scDiv.appendChild(ta);
        
        let miniCopyBtn = document.createElement('button');
        miniCopyBtn.innerText = "Copy Box";
        miniCopyBtn.style.marginTop = '3px';
        miniCopyBtn.style.padding = '4px';
        miniCopyBtn.style.fontSize = '10px';
        miniCopyBtn.style.background = '#3498db';
        miniCopyBtn.style.color = 'white';
        miniCopyBtn.style.border = 'none';
        miniCopyBtn.style.borderRadius = '3px';
        miniCopyBtn.style.cursor = 'pointer';
        miniCopyBtn.style.alignSelf = 'flex-start';
        miniCopyBtn.onclick = () => {
            if (ta.value) {
                ta.select();
                document.execCommand('copy');
                miniCopyBtn.innerText = "Copied!";
                setTimeout(() => miniCopyBtn.innerText = "Copy Box", 2000);
            }
        };
        scDiv.appendChild(miniCopyBtn);
        
        box.appendChild(scDiv);
    });

    let btnContainer = document.createElement('div');
    btnContainer.style.display = 'flex';
    btnContainer.style.gap = '5px';
    box.appendChild(btnContainer);

    function getTotalFound() {
        return conditions.reduce((acc, c) => acc + c.collected.size, 0);
    }

    // PLAY/PAUSE BUTTON
    let pauseBtn = document.createElement('button');
    pauseBtn.innerText = "Pause";
    pauseBtn.style.flex = '1';
    pauseBtn.style.padding = '8px';
    pauseBtn.style.background = '#f39c12'; // Orange
    pauseBtn.style.color = 'white';
    pauseBtn.style.border = 'none';
    pauseBtn.style.borderRadius = '4px';
    pauseBtn.style.cursor = 'pointer';
    pauseBtn.style.fontWeight = 'bold';
    pauseBtn.onclick = () => {
        if (paused) {
            paused = false;
            startTime = Date.now() - (elapsedSeconds * 1000);
            pauseBtn.innerText = "Pause";
            pauseBtn.style.background = '#f39c12';
            title.innerText = `Scanning... (${formatTime(elapsedSeconds)}) | Yr: ${lastFoundYear} | Total: ${getTotalFound()}`;
        } else {
            paused = true;
            pauseBtn.innerText = "Resume";
            pauseBtn.style.background = '#27ae60';
            title.innerText = `Paused (${formatTime(elapsedSeconds)}) | Yr: ${lastFoundYear} | Total: ${getTotalFound()}`;
        }
    };
    btnContainer.appendChild(pauseBtn);

    // STOP BUTTON
    let stopBtn = document.createElement('button');
    stopBtn.innerText = "Stop";
    stopBtn.style.flex = '1';
    stopBtn.style.padding = '8px';
    stopBtn.style.background = '#e74c3c';
    stopBtn.style.color = 'white';
    stopBtn.style.border = 'none';
    stopBtn.style.borderRadius = '4px';
    stopBtn.style.cursor = 'pointer';
    stopBtn.style.fontWeight = 'bold';
    stopBtn.onclick = () => {
        running = false;
        clearInterval(timerInterval);
        title.innerText = `Stopped (${formatTime(elapsedSeconds)}) | Yr: ${lastFoundYear} | Total: ${getTotalFound()}`;
        stopBtn.disabled = true;
        stopBtn.style.background = '#ccc';
        stopBtn.innerText = "Stopped";
        pauseBtn.disabled = true;
        pauseBtn.style.background = '#ccc';
        speedSlider.disabled = true;
    };
    btnContainer.appendChild(stopBtn);

    // COPY BUTTON
    let copyBtn = document.createElement('button');
    copyBtn.innerText = "Copy";
    copyBtn.style.flex = '1';
    copyBtn.style.padding = '8px';
    copyBtn.style.background = '#3498db';
    copyBtn.style.color = 'white';
    copyBtn.style.border = 'none';
    copyBtn.style.borderRadius = '4px';
    copyBtn.style.cursor = 'pointer';
    copyBtn.style.fontWeight = 'bold';
    copyBtn.onclick = () => {
        let allText = conditions.map(c => c.textareaEl.value).filter(v => v.length > 0).join('\n');
        
        let tempDiv = document.createElement("textarea");
        tempDiv.value = allText;
        document.body.appendChild(tempDiv);
        tempDiv.select();
        document.execCommand('copy');
        document.body.removeChild(tempDiv);

        copyBtn.innerText = "Copied!";
        setTimeout(() => copyBtn.innerText = "Copy", 2000);
    };
    btnContainer.appendChild(copyBtn);

    // CLOSE BUTTON
    let closeBtn = document.createElement('button');
    closeBtn.innerText = "X";
    closeBtn.style.width = '30px';
    closeBtn.style.padding = '8px';
    closeBtn.style.background = '#555';
    closeBtn.style.color = 'white';
    closeBtn.style.border = 'none';
    closeBtn.style.borderRadius = '4px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.fontWeight = 'bold';
    closeBtn.onclick = () => {
        running = false;
        clearInterval(timerInterval);
        box.remove();
    };
    btnContainer.appendChild(closeBtn);

    document.body.appendChild(box);


    function parseNumber(text) {
        if (!text) return 0;
        text = text.toLowerCase().replace(/,/g, '');

        if (text.includes("k")) {
            let numPart = parseFloat(text);
            return Math.round(numPart * 1000);
        }
        else if (text.includes("m")) {
            let numPart = parseFloat(text);
            return Math.round(numPart * 1000000);
        }
        let num = text.match(/\d+/);
        return num ? parseInt(num[0]) : 0;
    }

    function detectComments(post) {
        if (detectionMethod === 'robust') {
            // METHOD 2: DEEP TEXT SCAN (TreeWalker)
            const feedbackArea = post.querySelector('div[role="button"], span[role="toolbar"], .x1n2onr6');
            let searchRoot = feedbackArea || post;

            let walker = document.createTreeWalker(searchRoot, NodeFilter.SHOW_TEXT, null, false);
            let textNode;
            let texts = [];
            while ((textNode = walker.nextNode())) {
                let val = textNode.nodeValue.trim();
                if (val) texts.push(val);
            }
            let fullText = texts.join(' ');

            let patterns = [
                /([\d,]+(?:\.\d+)?[kKmM]?)\s*comments?/i,
                /view\s+([\d,]+(?:\.\d+)?[kKmM]?)\s*comments?/i,
                /([\d,]+(?:\.\d+)?[kKmM]?)\s*comment/i,
                /([\d,]+(?:\.\d+)?[kKmM]?)\s*মন্তব্য/i,
                /([\d,]+(?:\.\d+)?[kKmM]?)\s*टिप्पणियाँ/i,
                /comment\s*([\d,]+(?:\.\d+)?[kKmM]?)/i,
                /([\d,]+)\s+comments?/i 
            ];

            for (let p of patterns) {
                let match = fullText.match(p);
                if (match) return parseNumber(match[1]);
            }
            return 0;
        } else {
            // METHOD 1: SMART ACCURACY FOCUS (Selectors)
            const elements = post.querySelectorAll('[aria-label], a, div[role="button"], span[role="button"]');
            
            for (const el of elements) {
                const label = (el.getAttribute('aria-label') || "").toLowerCase();
                const text = (el.innerText || "").trim().toLowerCase();

                const containsCommentKeyword = label.includes('comment') || label.includes('মন্তব্য') || 
                                               text.includes('comment') || text.includes('মন্তব্য');
                
                const isLikeOrShare = label.includes('like') || label.includes('share') || label.includes('react') ||
                                      text.includes('like') || text.includes('share') || text.includes('react');

                if (containsCommentKeyword && !isLikeOrShare) {
                    if (label.includes('write') || label.includes('লিখুন') || text.includes('write') || text.includes('লিখুন')) continue;

                    let countMatch = label.match(/([\d,]+(?:\.\d+)?[kKmM]?)/);
                    if (countMatch) {
                        let count = parseNumber(countMatch[1]);
                        if (count > 0) return count;
                    }

                    countMatch = text.match(/([\d,]+(?:\.\d+)?[kKmM]?)/);
                    if (countMatch) {
                        let count = parseNumber(countMatch[1]);
                        if (count > 0) return count;
                    }
                }
            }

            const fullPostText = (post.innerText || "").replace(/\s+/g, ' ');
            const patternMatch = fullPostText.match(/([\d,]+(?:\.\d+)?[kKmM]?)\s*(?:comments?|মন্তব্য)/i);
            if (patternMatch) return parseNumber(patternMatch[1]);

            return 0;
        }
    }

    function getPostURL(post) {
        let allAnchors = Array.from(post.querySelectorAll('a'));
        
        let authorUsername = null;
        let authorId = null;

        // Step 1: Identify Author Info first
        for (let a of allAnchors) {
            let href = a.href.toLowerCase();
            // Skip common non-profile links
            if (href.includes('/posts/') || href.includes('/permalink') || href.includes('/photos') || href.includes('/photo') || href.includes('/groups/') || href.includes('/videos/') || href.includes('story_fbid')) continue;
            
            if (href.includes('profile.php?id=')) {
                authorId = new URL(a.href).searchParams.get('id');
                if (authorId) break;
            } else {
                let match = href.match(/facebook\.com\/([^\/\?]+)/);
                if (match && !['photo.php', 'photo', 'permalink', 'story.php', 'groups', 'watch', 'share', 'events', 'hashtag', 'profile', 'pages', 'stories', 'reel', 'videos', 'ads', 'gaming', 'marketplace', 'home', 'notifications', 'friends', 'groups', 'messages', 'watch', 'marketplace', 'bookmarks'].includes(match[1])) {
                    authorUsername = match[1];
                }
            }
        }

        let bestLink = null;
        let fallbackLink = null;

        // Step 2: Search for the best permalink
        for (let a of allAnchors) {
            let href = a.href.toLowerCase();
            let aria = (a.getAttribute('aria-label') || "").toLowerCase();
            let text = (a.textContent || "").toLowerCase();

            // CRITICAL: Reject Stories, Hashtags and other irrelevant links immediately
            if (href.includes('/stories/') || href.includes('/hashtag/') || href.includes('/l.php') || href.includes('javascript:') || href === '#') continue;
            
            // Priority 0: Post Feedback IDs / pfbid / story_fbid / specific permalinks
            if (href.includes('pfbid') || href.includes('/pfbid') || href.includes('story_fbid=') || href.includes('/permalink')) {
                bestLink = a;
                break;
            }

            // Priority 1: Contextual Permalinks (Comment buttons, Timestamps, Shares)
            if (href.includes('/posts/') || 
                href.includes('/groups/') ||
                href.includes('pfbid') ||
                href.includes('fbid=') ||
                aria.includes('comment') || aria.includes('share') || aria.includes('মন্তব্য') ||
                text.match(/\d+\s+comments?/i) || text.match(/\d+\s+মন্তব্য/i) ||
                text.includes('comment') || text.includes('share') ||
                href.includes('__cft__')) {
                
                // --- STRICT PROFILE EXCLUSION ---
                let isProfileOnly = false;
                if (authorUsername) {
                    const u = authorUsername.toLowerCase();
                    if (href.endsWith('/' + u) || href.endsWith('/' + u + '/') || href.includes('facebook.com/' + u + '?')) isProfileOnly = true;
                }
                if (authorId && href.includes('id=' + authorId) && !href.includes('fbid=') && !href.includes('story_fbid') && !href.includes('/posts/')) isProfileOnly = true;
                
                if (isProfileOnly) continue;

                if (aria.includes('comment') || text.includes('comment') || text.match(/\d+\s+comments?/i)) {
                    bestLink = a;
                } else if (!bestLink) {
                    bestLink = a;
                }
            }

            // Priority 2: Fallback Media links (Photo)
            if (!fallbackLink) {
                if (href.includes('/photo.php') || href.includes('/photo/') || href.includes('/photos/') || href.includes('/photo?')) {
                    fallbackLink = a;
                }
            }
        }

        let link = bestLink || fallbackLink;
        if (!link) return null;

        let hrefLower = link.href.toLowerCase();

        // Reject videos and reels
        if (hrefLower.includes('/videos/') || hrefLower.includes('/reel/') || hrefLower.includes('/watch/') || hrefLower.includes('/live/')) {
            return null;
        }

        let urlResult = null;
        try {
            let url = new URL(link.href);
            url.searchParams.delete('set');
            url.searchParams.delete('type');
            url.searchParams.delete('__cft__');
            url.searchParams.delete('__tn__');

            if (hrefLower.includes('/photo.php') || hrefLower.includes('/photo/') || hrefLower.includes('/photos/') || hrefLower.includes('/photo?')) {
                let postId = url.searchParams.get('story_fbid') || url.searchParams.get('fbid');
                if (!postId) {
                    let setParam = url.searchParams.get('set');
                    if (setParam && setParam.startsWith('pcb.')) {
                        postId = setParam.split('.')[1];
                    } else {
                        let match = url.pathname.match(/\/photos\/[^\/]+\/(\d+)/i) || url.pathname.match(/\/photo\/\?fbid=(\d+)/i);
                        if (match) postId = match[1];
                    }
                }
                
                if (postId && authorUsername) {
                    urlResult = `https://www.facebook.com/${authorUsername}/posts/${postId}`;
                } else if (postId && authorId) {
                    urlResult = `https://www.facebook.com/${authorId}/posts/${postId}`;
                } else if (postId) {
                    urlResult = `https://www.facebook.com/${postId}`;
                } else {
                    urlResult = url.href;
                }
            } else {
                if (url.pathname.includes('.php') || url.searchParams.has('id') || url.searchParams.has('story_fbid')) {
                    urlResult = url.href; 
                } else {
                    urlResult = url.origin + url.pathname.split('?')[0]; 
                }
            }
        } catch (e) { 
            urlResult = link.href.split('?')[0]; 
        }

        // Final sanity check: If the URL is just facebook.com/something without a post identifier, reject it.
        const pathParts = new URL(urlResult).pathname.split('/').filter(p => p.length > 0);
        if (pathParts.length === 1 && !urlResult.includes('fbid') && !urlResult.includes('story_fbid') && !urlResult.includes('posts')) {
            return null; 
        }

        return urlResult;
    }

    async function infiniteScroll() {
        console.log("Starting Infinite Scroll...");

        function openSmallWindow(url) {
            window.open(url, '_blank', 'width=450,height=700,menubar=no,status=no,titlebar=no,toolbar=no');
        }

        while (running) {
            if (paused) {
                await new Promise(r => setTimeout(r, 500));
                continue;
            }

            let posts = document.querySelectorAll('div[role="article"], div[role="feed"] > div, div.x1yztbdb, div[data-pagelet]');

            posts.forEach(post => {
                let textKey = post.textContent ? post.textContent.substring(0, 50) + post.textContent.length : "empty";
                if (post.getAttribute('data-viral-key') === textKey) return;
                post.setAttribute('data-viral-key', textKey);

                // Try to find the year for display
                let anchors = post.querySelectorAll('a');
                for (let a of anchors) {
                    let aria = a.getAttribute('aria-label');
                    let ym = (a.textContent && a.textContent.match(/\b(201\d|202\d)\b/)) || 
                             (aria && aria.match(/\b(201\d|202\d)\b/));
                    if (!ym && a.parentElement) {
                        ym = a.parentElement.textContent.match(/\b(201\d|202\d)\b/);
                    }
                    if (ym) {
                        lastFoundYear = ym[1];
                        break;
                    }
                }

                let count = detectComments(post);

                let matchedConditions = [];
                conditions.forEach((cond, index) => {
                    let passesMin = cond.min === null || count >= cond.min;
                    let passesMax = cond.max === null || count <= cond.max;
                    if (passesMin && passesMax && count > 0) { // count > 0 ensures we don't pick up posts with 0 comments unless specifically asked
                        matchedConditions.push(cond);
                    }
                });

                if (matchedConditions.length > 0) {
                    let url = getPostURL(post);

                    if (url) {
                        let newlyAdded = false;

                        matchedConditions.forEach((cond, index) => {
                            if (!cond.collected.has(url)) {
                                cond.collected.add(url);
                                newlyAdded = true;
                                
                                // Create a container for the link and an "Open" button if we wanted to (future enhancement)
                                cond.textareaEl.value += (cond.textareaEl.value ? '\n' : '') + url;
                                cond.textareaEl.scrollTop = cond.textareaEl.scrollHeight;

                                let labelPrefix = "";
                                if (cond.isMain) labelPrefix = `Main: Min ${cond.min}`;
                                else if (cond === conditions[1]) labelPrefix = `Range 1: ${cond.min !== null ? cond.min : '*'} to ${cond.max !== null ? cond.max : '*'}`;
                                else labelPrefix = `Range 2: ${cond.min !== null ? cond.min : '*'} to ${cond.max !== null ? cond.max : '*'}`;

                                cond.headerEl.innerText = `${labelPrefix} (Found: ${cond.collected.size})`;
                            }
                        });


                        if (newlyAdded) {
                            console.log("Found:", url, "Comments:", count);
                            post.style.border = "4px solid #2ecc71";
                            post.setAttribute('data-viral-checked', 'true');
                            
                            // Add a small "Open" button to the post itself for convenience
                            let openBtn = document.createElement('button');
                            openBtn.innerText = "Open Small";
                            openBtn.style.position = "absolute";
                            openBtn.style.top = "10px";
                            openBtn.style.right = "10px";
                            openBtn.style.zIndex = "1000";
                            openBtn.style.background = "#2ecc71";
                            openBtn.style.color = "white";
                            openBtn.style.border = "none";
                            openBtn.style.padding = "5px 10px";
                            openBtn.style.borderRadius = "5px";
                            openBtn.style.cursor = "pointer";
                            openBtn.onclick = (e) => {
                                e.preventDefault();
                                openSmallWindow(url);
                            };
                            post.style.position = "relative";
                            post.appendChild(openBtn);

                            title.innerText = `Scanning... (${formatTime(elapsedSeconds)}) | Total: ${getTotalFound()}`;
                        }
                    }
                }
            });

            window.scrollBy({
                top: 800,
                left: 0,
                behavior: scrollDelay < 150 ? 'auto' : 'smooth' 
            });

            await new Promise(r => setTimeout(r, scrollDelay));
        }
    }

    infiniteScroll();
}
