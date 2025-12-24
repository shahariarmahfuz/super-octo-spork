// অ্যাডমিন প্যানেলে ঢোকার পাসওয়ার্ড
const ADMIN_PASSWORD = "15"; 

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ================================================================
    // ১. অ্যাডমিন প্যানেল এবং API
    // ================================================================
    
    if (url.pathname === '/admin') {
      return handleAdminPage(request);
    }

    if (url.pathname === '/api/add' && request.method === 'POST') {
      return handleAddChannel(request, env);
    }

    if (url.pathname === '/api/delete' && request.method === 'POST') {
      return handleDeleteChannel(request, env);
    }

    if (url.pathname === '/api/list') {
      return handleListChannels(env);
    }

    // ================================================================
    // ২. ভিডিও স্ট্রিমিং লজিক (সংশোধিত)
    // ================================================================
    
    if (url.pathname.startsWith('/play/')) {
      const parts = url.pathname.split('/');
      const channelName = parts[2];
      
      // relativePath ঠিকভাবে বের করা (স্ল্যাশ সহ হ্যান্ডেল করার জন্য)
      const relativePath = parts.slice(3).join('/'); 

      const originalBaseUrl = await env.CHANNELS1.get(channelName);

      if (!originalBaseUrl) {
        return new Response("Channel not found.", { status: 404 });
      }

      let targetUrl;
      try {
        if (!relativePath) {
            targetUrl = originalBaseUrl;
        } else {
            const baseObj = new URL(originalBaseUrl);
            const basePath = baseObj.href.substring(0, baseObj.href.lastIndexOf('/') + 1);
            targetUrl = new URL(relativePath, basePath).href;
        }
      } catch (e) {
        return new Response("URL Error", { status: 500 });
      }

      try {
        const response = await fetch(targetUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Referer': new URL(targetUrl).origin
          }
        });

        // যদি M3U8 ফাইল হয়, তবে লিংক রিরাইট করতে হবে
        if (targetUrl.includes('.m3u8') || response.headers.get('Content-Type')?.includes('mpegurl')) {
          let m3u8Text = await response.text();
          
          // বর্তমান পাথ বা ডিরেক্টরি বের করা হচ্ছে
          let currentPathDir = '';
          if (relativePath && relativePath.includes('/')) {
             currentPathDir = relativePath.substring(0, relativePath.lastIndexOf('/') + 1);
          }

          // রিরাইট ফাংশনে বর্তমান ডিরেক্টরি পাঠানো হচ্ছে
          m3u8Text = rewriteM3u8(m3u8Text, url.origin, channelName, currentPathDir);

          return new Response(m3u8Text, {
            headers: {
              'Content-Type': 'application/vnd.apple.mpegurl',
              'Access-Control-Allow-Origin': '*'
            }
          });
        }

        // TS বা অন্য ফাইলের জন্য সরাসরি রেসপন্স
        const newRes = new Response(response.body, response);
        newRes.headers.set('Access-Control-Allow-Origin', '*');
        return newRes;

      } catch (e) {
        return new Response("Error fetching stream", { status: 500 });
      }
    }

    return new Response("Proxy Running. Go to /admin", { status: 200 });
  }
};

// ================= HELPER FUNCTIONS (সংশোধিত) =================

function rewriteM3u8(content, workerOrigin, channelName, pathPrefix) {
  const lines = content.split('\n');
  const newLines = lines.map(line => {
    line = line.trim();
    if (!line) return line;
    
    // যদি লাইনটি কমেন্ট না হয় (# দিয়ে শুরু না হয়)
    if (!line.startsWith('#')) {
      // যদি লাইনটি ইতিমধ্যে http দিয়ে শুরু হয় (Absolute URL), তবে সেটা হ্যান্ডেল করার লজিক (অপশনাল, এখানে সরল রাখা হলো)
      if(line.startsWith('http')) {
          return `${workerOrigin}/play/${channelName}/${line}`; // এটি সাধারণত এনকোড করা প্রয়োজন, তবে সিম্পল প্রক্সিতে এভাবেও চলতে পারে
      }
      
      // রিলেটিভ পাথের সাথে আগের ফোল্ডার (pathPrefix) যুক্ত করা হচ্ছে
      return `${workerOrigin}/play/${channelName}/${pathPrefix}${line}`;
    }
    return line;
  });
  return newLines.join('\n');
}

async function handleAdminPage(request) {
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Stream Admin</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; background: #f4f4f4; }
            .container { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
            input, button { padding: 10px; margin: 5px 0; width: 100%; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px;}
            button { background: #0070f3; color: white; border: none; cursor: pointer; }
            button:hover { background: #0051a2; }
            .item { border-bottom: 1px solid #eee; padding: 10px 0; }
            code { background: #eee; padding: 2px 5px; display: block; margin-top: 5px; word-break: break-all; }
            .hidden { display: none; }
            h3 { margin-top: 0; }
        </style>
    </head>
    <body>
        <div class="container">
            <h2 style="text-align:center;">Stream Controller</h2>
            
            <div id="loginSection">
                <input type="password" id="pass" placeholder="Enter Password">
                <button onclick="checkPass()">Login</button>
            </div>

            <div id="mainSection" class="hidden">
                <h3>Add Channel</h3>
                <input type="text" id="cName" placeholder="Name (e.g. sports)">
                <input type="text" id="cUrl" placeholder="Original M3U8 Link">
                <button onclick="addChannel()">Add Channel</button>

                <h3 style="margin-top:20px;">Channel List</h3>
                <div id="list">Loading...</div>
            </div>
        </div>

        <script>
            const API_PASS = "${ADMIN_PASSWORD}"; 

            function checkPass() {
                if(document.getElementById('pass').value === API_PASS) {
                    document.getElementById('loginSection').classList.add('hidden');
                    document.getElementById('mainSection').classList.remove('hidden');
                    loadChannels();
                } else { alert('Wrong Password'); }
            }

            async function addChannel() {
                const name = document.getElementById('cName').value.trim();
                const url = document.getElementById('cUrl').value.trim();
                if(!name || !url) return alert('Fill all fields');
                
                await fetch('/api/add', {
                    method: 'POST',
                    body: JSON.stringify({name, url})
                });
                document.getElementById('cName').value = '';
                document.getElementById('cUrl').value = '';
                loadChannels();
            }

            async function deleteChannel(name) {
                if(!confirm('Delete ' + name + '?')) return;
                await fetch('/api/delete', {
                    method: 'POST',
                    body: JSON.stringify({name})
                });
                loadChannels();
            }

            async function loadChannels() {
                const res = await fetch('/api/list');
                const channels = await res.json();
                const list = document.getElementById('list');
                list.innerHTML = '';
                
                for (const [name, url] of Object.entries(channels)) {
                    const proxyLink = window.location.origin + '/play/' + name;
                    list.innerHTML += \`
                        <div class="item">
                            <div style="font-weight:bold; color: #333;">\${name}</div>
                            <small style="color: #666;">Orig: \${url.substring(0, 30)}...</small>
                            <code>\${proxyLink}</code>
                            <button onclick="deleteChannel('\${name}')" style="background:#ff4d4f; margin-top:5px;">Delete</button>
                        </div>
                    \`;
                }
            }
        </script>
    </body>
    </html>
    `;
    return new Response(html, { headers: { 'Content-Type': 'text/html' } });
}

// ================= API HANDLERS =================

async function handleAddChannel(req, env) {
    const data = await req.json();
    await env.CHANNELS1.put(data.name, data.data || data.url);
    return new Response("Added");
}

async function handleDeleteChannel(req, env) {
    const data = await req.json();
    await env.CHANNELS1.delete(data.name);
    return new Response("Deleted");
}

async function handleListChannels(env) {
    // এখানে ভুল ছিল 'constlist', ঠিক করা হলো 'const list'
    const list = await env.CHANNELS1.list();
    const channels = {};
    for(const key of list.keys) {
        channels[key.name] = await env.CHANNELS1.get(key.name);
    }
    return new Response(JSON.stringify(channels));
}
