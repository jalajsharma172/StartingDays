require("dotenv").config();

const express = require("express");
const axios = require("axios");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static("public"));

const upload = multer({ dest: "uploads/" });

let accessToken = null;
let linkedinUserId = null;

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const PORT = process.env.PORT;

// Serving static frontend via public folder

/**
 * Step 1
 * Redirect user to LinkedIn Login
 */
app.get("/auth/linkedin", (req, res) => {

    const scope = "openid profile w_member_social";

    const url =
        "https://www.linkedin.com/oauth/v2/authorization" +
        `?response_type=code` +
        `&client_id=${CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&scope=${encodeURIComponent(scope)}`;

    res.redirect(url);
});

/**
 * Step 2
 * LinkedIn redirects here
 */
app.get("/auth/callback", async (req, res) => {

    try {

        const code = req.query.code;

        if (!code) {
            return res.send("No authorization code received.");
        }

        console.log("Authorization Code:");
        console.log(code);

        // --- DEBUG LOGS TO HELP DIAGNOSE RENDER ISSUES ---
        const safeClientId = process.env.CLIENT_ID ? process.env.CLIENT_ID.trim() : "";
        const safeClientSecret = process.env.CLIENT_SECRET ? process.env.CLIENT_SECRET.trim() : "";
        const safeRedirectUri = process.env.REDIRECT_URI ? process.env.REDIRECT_URI.trim() : "";

        console.log("--- DEBUG CREDENTIALS ---");
        console.log("CLIENT_ID Length:", safeClientId.length);
        console.log("CLIENT_SECRET Length:", safeClientSecret.length);
        console.log("REDIRECT_URI Exact:", `"${safeRedirectUri}"`);
        console.log("-------------------------");

        if (!safeClientId || !safeClientSecret) {
            return res.status(500).send("Error: CLIENT_ID or CLIENT_SECRET is missing. Check Render Environment Variables.");
        }

        /**
         * Exchange code for Access Token
         */

        const tokenResponse = await axios.post(
            "https://www.linkedin.com/oauth/v2/accessToken",
            new URLSearchParams({
                grant_type: "authorization_code",
                code,
                redirect_uri: safeRedirectUri,
                client_id: safeClientId,
                client_secret: safeClientSecret
            }).toString(),
            {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                }
            }
        );

        console.log("\nAccess Token:\n");
        console.log(tokenResponse.data);

        accessToken = tokenResponse.data.access_token;

        // Fetch user profile to get URN
        const profileResponse = await axios.get("https://api.linkedin.com/v2/userinfo", {
            headers: {
                "Authorization": `Bearer ${accessToken}`
            }
        });

        linkedinUserId = profileResponse.data.sub;
        console.log("LinkedIn User ID:", linkedinUserId);

        res.send(`
            <h2>Authorization Successful</h2>
            <p>Access Token acquired.</p>
            <p>LinkedIn User ID: <strong>${linkedinUserId}</strong></p>
            <a href="/">Go to Share Dashboard</a>
        `);

    } catch (err) {

        console.log(err.response?.data || err.message);

        res.status(500).send(err.response?.data || err.message);

    }

});

// Endpoint to post plain text
app.post("/share/text", async (req, res) => {
    const { text } = req.body;

    if (!accessToken || !linkedinUserId) {
        return res.status(401).json({ error: "Not authorized. Please login first." });
    }

    try {
        const response = await axios.post(
            "https://api.linkedin.com/rest/posts",
            {
                author: `urn:li:person:${linkedinUserId}`,
                commentary: text,
                visibility: "PUBLIC",
                distribution: {
                    feedDistribution: "MAIN_FEED",
                    targetEntities: [],
                    thirdPartyDistributionChannels: []
                },
                lifecycleState: "PUBLISHED",
                isReshareDisabledByAuthor: false
            },
            {
                headers: {
                    "Authorization": `Bearer ${accessToken}`,
                    "LinkedIn-Version": "202401",
                    "X-Restli-Protocol-Version": "2.0.0",
                    "Content-Type": "application/json"
                }
            }
        );

        res.json({ success: true, data: response.data || "Success" });
    } catch (err) {
        console.error(err.response?.data || err.message);
        res.status(500).json({ error: err.response?.data || err.message });
    }
});

// Endpoint to post text + image
app.post("/share/image", upload.single("image"), async (req, res) => {
    const { text } = req.body;
    const imageFile = req.file;

    if (!accessToken || !linkedinUserId) {
        return res.status(401).json({ error: "Not authorized. Please login first." });
    }

    if (!imageFile) {
        return res.status(400).json({ error: "No image provided." });
    }

    try {
        // Step 1: Initialize Image Upload
        const registerResponse = await axios.post(
            "https://api.linkedin.com/rest/images?action=initializeUpload",
            {
                initializeUploadRequest: {
                    owner: `urn:li:person:${linkedinUserId}`
                }
            },
            {
                headers: {
                    "Authorization": `Bearer ${accessToken}`,
                    "LinkedIn-Version": "202401",
                    "X-Restli-Protocol-Version": "2.0.0",
                    "Content-Type": "application/json"
                }
            }
        );

        const uploadUrl = registerResponse.data.value.uploadUrl;
        const imageUrn = registerResponse.data.value.image;

        // Step 2: Upload Image Binary
        const imageBuffer = fs.readFileSync(imageFile.path);
        
        await axios.put(uploadUrl, imageBuffer, {
            headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Content-Type": "application/octet-stream"
            }
        });

        // Step 3: Create Post with Image
        const postResponse = await axios.post(
            "https://api.linkedin.com/rest/posts",
            {
                author: `urn:li:person:${linkedinUserId}`,
                commentary: text,
                visibility: "PUBLIC",
                distribution: {
                    feedDistribution: "MAIN_FEED",
                    targetEntities: [],
                    thirdPartyDistributionChannels: []
                },
                content: {
                    media: {
                        id: imageUrn
                    }
                },
                lifecycleState: "PUBLISHED",
                isReshareDisabledByAuthor: false
            },
            {
                headers: {
                    "Authorization": `Bearer ${accessToken}`,
                    "LinkedIn-Version": "202401",
                    "X-Restli-Protocol-Version": "2.0.0",
                    "Content-Type": "application/json"
                }
            }
        );

        // Clean up the uploaded file
        fs.unlinkSync(imageFile.path);

        res.json({ success: true, data: postResponse.data || "Success" });
    } catch (err) {
        if (imageFile && fs.existsSync(imageFile.path)) {
            fs.unlinkSync(imageFile.path); // cleanup on error
        }
        console.error(err.response?.data || err.message);
        res.status(500).json({ error: err.response?.data || err.message });
    }
});

app.listen(PORT, () => {

    console.log("Server running");

    console.log("Open:");

    console.log(`http://localhost:${PORT}/auth/linkedin`);

});