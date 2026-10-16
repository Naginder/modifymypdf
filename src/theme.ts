const requestedTheme = new URLSearchParams(window.location.search).get('clawpilotTheme');
document.documentElement.setAttribute('data-theme', requestedTheme === 'dark' ? 'dark' : 'light');
