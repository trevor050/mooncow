/*
const fetch = require('node-fetch');

fetch('https://r.jina.ai/https://www.example.com', {
    method: 'GET',
    headers: {
        'Authorization': 'Bearer REDACTED_JINA_KEY',
        'X-Engine': 'direct',
        'X-Retain-Images': 'none',
        'X-With-Links-Summary': 'all'
    }
})
.then(response => response.text())
.then(data => console.log(data))
.catch(error => console.error(error));
