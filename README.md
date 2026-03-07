📦 Stifficiency

AI-Powered, Hands-Free Inventory Management
Wave. Show. Place. Done.
A fixed camera watches your storage area. Hold up an item — it identifies it.
Place it on a shelf — it logs where. Ask "where's my blue toolbox?" — it highlights the shelf.
No scanning. No typing. No barcodes. Just your voice, your hands, and a camera.

The Problem 
Warehouses, small businesses, schools, and offices all have the same issue: stuff gets lost. Someone puts a toolbox on Shelf 3, forgets to log it, and three days later the whole team is searching. Barcode systems exist, but they require labels on everything, dedicated scanners, and someone who actually remembers to scan. Most small teams just... don't.

The Solution
TrackHive replaces the entire scan-and-log workflow with a single fixed camera and natural interaction. You walk up, hold the item to the camera, place it where it goes, and the system handles the rest. When you need to find something, you ask — out loud or by typing — and the camera feed highlights exactly where it is.
The key insight: we don't stream video to AI continuously. We built a quality gate that evaluates every frame locally using cheap Canvas API operations (blur detection, brightness check, edge analysis) and only sends the one good frame to Gemini Vision. Out of hundreds of frames, typically only 3–6 ever hit the API. This makes the system fast, affordable, and demo-ready.

How It Works
1. Setup — Teach the Camera
When you first open TrackHive, you see your live camera feed. You draw bounding boxes directly on the video around each storage area — a shelf, a drawer, a bin — and name them. These zones are saved to the database and stay overlaid on the camera feed permanently.
2. Add an Item
Wave at the camera to wake the system. Hold up an item — a water bottle, a toolbox, a jacket. The quality gate watches every frame, rejecting blurry, dark, or partially-visible ones. The moment you hold the item still and it's clearly in frame, that single frame is captured and sent to Gemini Vision.
Gemini returns structured data: the item name, its type, distinguishing features as concrete key-value pairs ({ color: "blue", brand: "DeWalt", size: "large" }), and a confidence score. You walk to a storage zone and place the item. The system tracks which zone you're in front of and logs the item there — confirmed either silently via UI or spoken aloud through ElevenLabs, depending on your settings.
3. Find an Item
Say "Where is the blue toolbox?" or type it. The system queries the database, finds the match, and the corresponding zone glows on the camera feed while the inventory panel highlights the item card. If voice is enabled, ElevenLabs speaks the location.
4. Remove an Item
Hold the item to the camera again. The system identifies it, matches it against the database, and marks it as removed. The zone's item count updates in real time.

Built in 48 hours. Powered by coffee and Gemini.
