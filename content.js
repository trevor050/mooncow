const iframeId = 'mooncow-search-iframe';
let isPinned = false;

document.addEventListener('keydown', (event) => {
  // Check for CTRL+E on Windows/Linux or Command+E on Mac
  if (event.key === 'e' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    toggleSearch();
  }
}, true); // Use capture phase to ensure we get the event first

function closeSearch() {
  const existingIframe = document.getElementById(iframeId);
  if (existingIframe) {
    existingIframe.style.animation = 'fluidOut 0.2s cubic-bezier(0.165, 0.84, 0.44, 1) forwards';
    setTimeout(() => {
        existingIframe.remove();
        // Clean up body class and injected CSS
        document.body.classList.remove('mooncow-extension-active');
        const injectedStyle = document.head.querySelector('style[data-mooncow]');
        if (injectedStyle) {
            injectedStyle.remove();
        }
    }, 200);
    window.removeEventListener('click', handleOutsideClick, true);
    isPinned = false; // Always unpin on close
  }
}

function handleOutsideClick(event) {
    if (isPinned) return;
    const iframe = document.getElementById(iframeId);
    if (iframe && event.target !== iframe) {
        closeSearch();
    }
}

function toggleSearch() {
  const existingIframe = document.getElementById(iframeId);

  if (existingIframe) {
    closeSearch();
  } else {
    const iframe = document.createElement('iframe');
    iframe.id = iframeId;
    iframe.src = browser.runtime.getURL('search.html');
    iframe.style.backgroundColor = 'transparent'; // For glassmorphism
    iframe.style.position = 'fixed';
    iframe.style.top = '10%';
    iframe.style.left = '50%';
    iframe.style.transform = 'translateX(-50%)';
    iframe.style.width = '600px';
    iframe.style.height = '365px';
    iframe.style.border = 'none';
    iframe.style.borderRadius = '12px';
    iframe.style.boxShadow = '0 20px 50px rgba(0, 0, 0, 0.3)';
    iframe.style.zIndex = '2147483647'; // Maximum possible z-index value
    iframe.style.animation = 'fluidIn 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards';
    
    // Force iframe to be on top with additional CSS properties
    iframe.style.setProperty('position', 'fixed', 'important');
    iframe.style.setProperty('z-index', '2147483647', 'important');
    iframe.style.setProperty('pointer-events', 'auto', 'important');
    iframe.style.setProperty('visibility', 'visible', 'important');
    iframe.style.setProperty('opacity', '1', 'important');
    iframe.style.setProperty('display', 'block', 'important');
    
    // Add class to body to prevent page interference
    document.body.classList.add('mooncow-extension-active');
    
    // Inject CSS to ensure nothing can override our iframe
    const style = document.createElement('style');
    style.setAttribute('data-mooncow', 'true');
    style.textContent = `
      .mooncow-extension-active #${iframeId} {
        position: fixed !important;
        z-index: 2147483647 !important;
        pointer-events: auto !important;
        visibility: visible !important;
        opacity: 1 !important;
        display: block !important;
        transform: translateX(-50%) !important;
      }
    `;
    document.head.appendChild(style);
    
    // Ensure focus happens when iframe is loaded
    iframe.onload = () => {
        setTimeout(() => {
            const searchInput = iframe.contentDocument?.getElementById('search-input');
            if (searchInput) {
                searchInput.focus();
            }
        }, 50);
    };
    
    document.body.appendChild(iframe);
    setTimeout(() => window.addEventListener('click', handleOutsideClick, true), 0);
  }
} 

window.addEventListener('message', (event) => {
  const iframe = document.getElementById(iframeId);
  if (!iframe || event.source !== iframe.contentWindow) return;
  const data = event.data;
  
  switch (data.action) {
    case "startDrag": {
      const rect = iframe.getBoundingClientRect();
      console.log('Before drag - rect:', rect);
      console.log('Before drag - computed style:', window.getComputedStyle(iframe));
      
      iframe.style.transition = 'none';
      // Force a reflow to ensure the transition change takes effect
      iframe.offsetHeight;
      
      // Calculate the pixel positions BEFORE removing transform
      const targetTop = rect.top;
      const targetLeft = rect.left;
      
      // Now atomically update both transform and position to prevent jumping
      // Use setProperty with !important to override the CSS rule
      iframe.style.setProperty('transform', 'none', 'important');
      iframe.style.top = `${targetTop}px`;
      iframe.style.left = `${targetLeft}px`;
      
      console.log('After setting position - computed style:', window.getComputedStyle(iframe));
      const newRect = iframe.getBoundingClientRect();
      console.log('After setting position - new rect:', newRect);
      break;
    }
    case "moveDrag": {
      const curTop = parseFloat(iframe.style.top) || 0;
      const curLeft = parseFloat(iframe.style.left) || 0;
      iframe.style.top = `${curTop + data.dy}px`;
      iframe.style.left = `${curLeft + data.dx}px`;
      break;
    }
    case "endDrag": {
      iframe.style.transition = '';
      // Leave it in pixel mode - don't restore the percentage positioning
      break;
    }
    case "togglePin":
      isPinned = data.pinned;
      break;
    case "expandForChat":
      iframe.style.transition = 'height 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
      iframe.style.height = '625px';
      break;
    case "contractFromChat":
      iframe.style.transition = 'height 0.2s ease-out';
      iframe.style.height = '365px';
      break;
  }
}); 

// Listen for requests from the extension to extract the current page text context
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'extractPageText') {
        try {
            // Grab visible text on the page and normalise whitespace
            const rawText = document.body ? document.body.innerText || '' : '';
            const cleaned = rawText.replace(/\s+/g, ' ').trim();
            // Limit to ~8k characters to stay within token budgets
            const snippet = cleaned.slice(0, 8000);
            sendResponse({ text: snippet });
        } catch (err) {
            console.error('[Mooncow] Failed to extract page text:', err);
            sendResponse({ text: '' });
        }
        return true; // Keep the message channel open for async response
    }
}); 