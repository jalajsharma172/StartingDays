require("dotenv").config();

const express = require("express");
const axios = require("axios");

const app = express();

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

app.get("/", (req, res) => {
    res.send("LinkedIn OAuth Server Running");
});

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

        /**
         * Exchange code for Access Token
         */

        const tokenResponse = await axios.post(

            "https://www.linkedin.com/oauth/v2/accessToken",

            new URLSearchParams({
                grant_type: "authorization_code",
                code,
                redirect_uri: REDIRECT_URI,
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET
            }),

            {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                }
            }

        );

        console.log("\nAccess Token:\n");

        console.log(tokenResponse.data);

        res.send(`
            <h2>Authorization Successful</h2>

            <pre>${JSON.stringify(tokenResponse.data, null, 2)}</pre>

            <p>Copy the access_token and store it securely.</p>
        `);

    } catch (err) {

        console.log(err.response?.data || err.message);

        res.status(500).send(err.response?.data || err.message);

    }

});

app.listen(5000, () => {

    console.log("Server running");

    console.log("Open:");

    console.log("http://localhost:5000/auth/linkedin");

});