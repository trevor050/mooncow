/*
const fetch = require('node-fetch');

fetch('https://r.jina.ai/https://www.example.com', { //Jina Reader API, input any URL return cleaned text
    method: 'GET',
    headers: {
        'Authorization': 'Bearer jina_16d64a38654443bd8f6bae0056136a0a2jMsoYZ9JQWo1501eyIIK1SJLxs5',
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
  -H "Authorization: Bearer jina_7320aa7551104f019eee2739e5ca7ed0LbiZqqgrRrdwUter-TFUd4FTeYrS" \
  -H "Content-Type: application/json" \
  -H "X-Respond-With: no-content" \
  -d @- <<EOFEOF
  {
    "q": "Jina AI"
  }
EOFEOF
*/

/* tool call one example usage idea <tool>{"tool":"jina","type":"search","queries":["Jina AI","Jina"]}</tool>
    tool call two example usage idea <tool>{"tool":"jina","type":"read",queries["htt"]}</tool>
*/