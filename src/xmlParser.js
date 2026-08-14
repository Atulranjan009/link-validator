const https = require("https");
const http = require("http");

function fetchText(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);

    const client =
      parsed.protocol === "https:" ? https : http;

    const request = client.get(
      url,
      {
        headers: {
          "User-Agent": "Salesforce-Broken-Link-Validator/1.0"
        }
      },
      response => {
        if (
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          const nextUrl = new URL(
            response.headers.location,
            url
          ).toString();

          response.resume();

          return fetchText(nextUrl, timeoutMs)
            .then(resolve)
            .catch(reject);
        }

        let data = "";

        response.setEncoding("utf8");

        response.on("data", chunk => {
          data += chunk;
        });

        response.on("end", () => {
          if (response.statusCode >= 400) {
            reject(
              new Error(
                `Sitemap returned HTTP ${response.statusCode}`
              )
            );
          } else {
            resolve(data);
          }
        });
      }
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(
        new Error("Sitemap request timed out")
      );
    });

    request.on("error", reject);
  });
}

class XMLParser {
  static extractLocs(xml) {
    const matches = [
      ...xml.matchAll(
        /<loc>\s*([\s\S]*?)\s*<\/loc>/gi
      )
    ];

    return matches
      .map(match => match[1].trim())
      .filter(Boolean);
  }

  static async fromUrl(url) {
    return fetchText(url);
  }
}

module.exports = {
  XMLParser
};
