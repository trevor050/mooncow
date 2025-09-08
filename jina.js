/*
const fetch = require('node-fetch');

fetch('https://r.jina.ai/https://www.example.com', { // Jina Reader API, input any URL return cleaned text
    method: 'GET',
    headers: {
        // Set at runtime: 'Authorization': 'Bearer <YOUR_JINA_API_KEY>',
        'X-Engine': 'direct',
        'X-Retain-Images': 'none',
        'X-With-Links-Summary': 'all'
    }
})
.then(response => response.text())
.then(data => console.log(data))
.catch(error => console.error(error));

*/

/*
curl "https://s.jina.ai/" \
  -H "Authorization: Bearer <YOUR_JINA_API_KEY>" \
  -H "Content-Type: application/json" \
  -H "X-Respond-With: no-content" \
  -d @- <<EOFEOF
  {
    "q": "Jina AI"
  }
EOFEOF
*/

/* tool call one example usage idea <tool>{"tool":"jina","type":"search","queries":["Jina AI","Jina"]}</tool>
    tool call two example usage idea <tool>{"tool":"jina","type":"read","queries":["https://www.example.com","https://jina.ai"]}</tool>
*/