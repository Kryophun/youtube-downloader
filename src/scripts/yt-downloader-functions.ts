import type { AdaptiveFormatItem, FormatItem, PlayerResponse } from "./types";

export async function getRemote(url: string): Promise<string> {
  const response = await fetch(url);
  return response.text();
}

const gRegex = {
  videoData: /ytInitialPlayerResponse\s*=\s*({.+?})\s*;\s*(?:var\s+meta|<\/script|\n)/,
  playlistData: /ytInitialData\s*=\s*({.+?})\s*;/,
  playerData: /set\(({.+?})\);/
};

function getStringBetween(
  string: string,
  needleStart: string,
  needleEnd?: string,
  offsetStart = 0,
  offsetEnd = 0
): string {
  const x = string.indexOf(needleStart);
  const y = needleEnd ? string.indexOf(needleEnd, x) : string.length;
  return string.substring(x + needleStart.length + offsetEnd, y + offsetStart);
}

async function getAdaptiveFormats({
  videoData,
  playerData
}: {
  videoData: PlayerResponse;
  playerData: { PLAYER_JS_URL: string };
}) {
  console.log("getAdaptiveFormats: Starting signature deciphering process");
  console.log("getAdaptiveFormats: Player JS URL:", playerData.PLAYER_JS_URL);

  // eslint-disable-next-line @typescript-eslint/ban-types
  const getDecipherFunction = (string: string): Function => {
    console.log("getDecipherFunction: Starting to parse player JS");
    console.log("getDecipherFunction: Input string length:", string.length);
    console.log("getDecipherFunction: First 200 chars:", string.substring(0, 200));
    console.log("getDecipherFunction: Last 200 chars:", string.substring(string.length - 200));

    try {
      const js = string.replace("var _yt_player={}", "");
      console.log("getDecipherFunction: After _yt_player replacement, length:", js.length);

      // Look for split patterns dynamically
      console.log("getDecipherFunction: Looking for split patterns...");
      const splitMatches = js.match(/[a-zA-Z]=\w+\.split\(""\)/g);
      console.log("getDecipherFunction: Found split patterns:", splitMatches?.slice(0, 5));

      if (!splitMatches || splitMatches.length === 0) {
        throw new Error("No split patterns found in player JS");
      }

      // Use the first found pattern
      const splitPattern = splitMatches[0];
      console.log("getDecipherFunction: Using split pattern:", splitPattern);

      const splitIndex = js.indexOf(splitPattern);
      console.log("getDecipherFunction: Pattern found at index:", splitIndex);

      const top = getStringBetween(js, splitPattern, "};", 1, -28);
      console.log("getDecipherFunction: Extracted top length:", top.length);
      console.log("getDecipherFunction: Extracted top:", top.substring(0, 200) + "...");

      // Extract function name from the split pattern itself
      // Pattern is like "e=e.split("")", so we need to find what calls this
      // Look for the function that contains this pattern
      const contextBefore = js.substring(splitIndex - 500, splitIndex);
      console.log(
        "getDecipherFunction: Context before split:",
        contextBefore.substring(contextBefore.length - 100)
      );

      // Find the function declaration pattern before the split
      const functionMatch = contextBefore.match(
        /([a-zA-Z$_][a-zA-Z0-9$_]*)\s*=\s*function\s*\([^)]*\)\s*\{[^}]*$/
      );
      let functionName;

      if (functionMatch) {
        functionName = functionMatch[1];
        console.log("getDecipherFunction: Found function name from context:", functionName);
      } else {
        // Fallback: try to extract from the pattern itself
        const varMatch = splitPattern.match(/([a-zA-Z$_][a-zA-Z0-9$_]*)\s*=/);
        if (varMatch) {
          functionName = varMatch[1];
          console.log("getDecipherFunction: Extracted function name from pattern:", functionName);
        } else {
          throw new Error("Could not extract function name from split pattern");
        }
      }

      console.log("getDecipherFunction: Using function name:", functionName);

      // Check if this pattern exists in the JS
      let actualPattern = "var " + functionName + "=";
      let functionIndex = js.indexOf(actualPattern);
      console.log("getDecipherFunction: Function pattern found at index:", functionIndex);

      if (functionIndex === -1) {
        console.log("getDecipherFunction: Trying alternative function patterns...");
        // Try different patterns
        const patterns = [
          `${functionName}=function`,
          `${functionName}:function`,
          `function ${functionName}`,
          `${functionName}=`
        ];

        for (const pattern of patterns) {
          const altIndex = js.indexOf(pattern);
          console.log(`getDecipherFunction: Pattern "${pattern}" found at:`, altIndex);
          if (altIndex !== -1) {
            console.log(
              `getDecipherFunction: Context around "${pattern}":`,
              js.substring(altIndex - 50, altIndex + 200)
            );
            actualPattern = pattern;
            functionIndex = altIndex;
            break;
          }
        }

        if (functionIndex === -1) {
          throw new Error(`Function pattern for "${functionName}" not found in player JS`);
        }
      }

      console.log("getDecipherFunction: Using pattern:", actualPattern);
      console.log("getDecipherFunction: Pattern found at index:", functionIndex);

      // Instead of using getStringBetween, manually find the complete function
      const functionStart = js.indexOf(actualPattern);
      const functionBodyStart = js.indexOf("{", functionStart);

      if (functionBodyStart === -1) {
        throw new Error("Could not find function body start");
      }

      // Find the matching closing brace by counting braces
      let braceCount = 1;
      let currentIndex = functionBodyStart + 1;

      while (braceCount > 0 && currentIndex < js.length) {
        const char = js[currentIndex];
        if (char === "{") {
          braceCount++;
        } else if (char === "}") {
          braceCount--;
        }
        currentIndex++;
      }

      if (braceCount > 0) {
        throw new Error("Could not find matching closing brace for function");
      }

      const functionEnd = currentIndex;
      const completeFunction = js.substring(functionStart, functionEnd);

      console.log("getDecipherFunction: Complete function length:", completeFunction.length);
      console.log("getDecipherFunction: Complete function:", completeFunction.substring(0, 200) + "...");
      console.log(
        "getDecipherFunction: Function end:",
        completeFunction.substring(completeFunction.length - 20)
      );

      // Wrap the function definition to properly evaluate and return the function
      let executableCode;
      if (actualPattern.includes("=function")) {
        // For patterns like "D7=function", extract just the function part
        const functionPart = completeFunction.substring(completeFunction.indexOf("function"));
        console.log("getDecipherFunction: Raw function part:", functionPart.substring(0, 200) + "...");
        console.log("getDecipherFunction: Full function part length:", functionPart.length);
        console.log(
          "getDecipherFunction: Function part end:",
          functionPart.substring(functionPart.length - 50)
        );

        // Try to validate the function syntax before wrapping
        try {
          executableCode = `(${functionPart})`;
          console.log(
            "getDecipherFunction: Wrapped function code:",
            executableCode.substring(0, 100) + "..."
          );

          // Test if the syntax is valid by trying to parse it
          const testFunc = eval(executableCode);
          console.log("getDecipherFunction: Function created successfully, type:", typeof testFunc);
          return testFunc;
        } catch (syntaxError) {
          console.error("getDecipherFunction: Syntax error in extracted function:", syntaxError.message);
          console.log("getDecipherFunction: Problematic code:", functionPart);
          throw new Error(`Invalid function syntax: ${syntaxError.message}`);
        }
      } else {
        // For other patterns, use as-is
        executableCode = completeFunction;
        return eval(executableCode);
      }
    } catch (error) {
      console.error("getDecipherFunction: Error during parsing:", error);
      console.error("getDecipherFunction: Error details:", error.message);
      throw error;
    }
  };

  try {
    console.log("getAdaptiveFormats: Fetching player JS content");
    const baseContent = await getRemote(`https://www.youtube.com${playerData.PLAYER_JS_URL}`);
    console.log("getAdaptiveFormats: Player JS content length:", baseContent.length);
    console.log("getAdaptiveFormats: Player JS first 200 chars:", baseContent.substring(0, 200));

    console.log("getAdaptiveFormats: Calling getDecipherFunction");
    const decipher = getDecipherFunction(baseContent);
    console.log("getAdaptiveFormats: Successfully created decipher function");

    const getUrlFromSignature = (signatureCipher: string): string => {
      const searchParams = new URLSearchParams(signatureCipher);
      const [url, signature, sp] = [searchParams.get("url"), searchParams.get("s"), searchParams.get("sp")];

      return `${url}&${sp}=${decipher(signature)}`;
    };

    const {
      streamingData: { adaptiveFormats }
    } = videoData;

    console.log("getAdaptiveFormats: Processing", adaptiveFormats.length, "adaptive formats");

    adaptiveFormats.forEach(format => {
      // Only process formats that actually have a signatureCipher
      if (format.signatureCipher) {
        console.log("getAdaptiveFormats: Processing signatureCipher for format", format.itag);
        format.url = getUrlFromSignature(format.signatureCipher);
        delete format.signatureCipher;
      } else {
        console.log("getAdaptiveFormats: Format", format.itag, "already has direct URL, skipping");
      }
    });

    return adaptiveFormats;
  } catch (error) {
    console.error("getAdaptiveFormats: Error in adaptive formats processing:", error);
    throw error;
  }
}

async function getDownloadableLinks(formats: AdaptiveFormatItem[] | FormatItem[]) {
  const downloadableLinks = [];

  for (const format of formats) {
    try {
      const res = await fetch(format.url);
      if (res.ok) {
        downloadableLinks.push(format);
      }
      // eslint-disable-next-line no-empty
    } catch {}
  }
  return downloadableLinks;
}

export async function getVideoData(htmlYouTubePage: string): Promise<PlayerResponse> {
  console.log("getVideoData: Starting video data extraction");

  // Check for alternative streaming data sources in the HTML
  console.log("getVideoData: Checking for alternative streaming data sources...");

  // First try: Custom streaming data extractor with proper brace counting
  const findCompleteStreamingData = (html: string) => {
    const streamingDataMatch = html.match(/"streamingData":\s*\{/);
    if (streamingDataMatch) {
      const startIndex = streamingDataMatch.index! + streamingDataMatch[0].length - 1;

      // Extract complete JSON object by counting braces
      let braceCount = 0;
      let endIndex = startIndex;

      for (let i = startIndex; i < html.length; i++) {
        if (html[i] === "{") braceCount++;
        else if (html[i] === "}") braceCount--;

        if (braceCount === 0) {
          endIndex = i;
          break;
        }
      }

      const streamingDataJson = html.substring(startIndex, endIndex + 1);

      // Check if this contains URLs
      if (streamingDataJson.includes('"url"') && streamingDataJson.includes("https://")) {
        console.log("getVideoData: Found streaming data with URLs using custom extractor");
        console.log("getVideoData: Streaming data preview:", streamingDataJson.substring(0, 200) + "...");
        try {
          const streamingData = JSON.parse(streamingDataJson);
          return { streamingData };
        } catch (error) {
          console.log("getVideoData: Failed to parse custom extracted streaming data:", error);
        }
      }
    }
    return null;
  };

  let streamingDataWithUrls = findCompleteStreamingData(htmlYouTubePage);

  // Second try: Use regex patterns if custom extractor didn't work
  if (!streamingDataWithUrls) {
    // Look for different YouTube data patterns - use more specific patterns to capture complete streaming data
    const alternativePatterns = [
      /"streamingData":\s*(\{[^{}]*"formats":\s*\[[^\]]*\][^{}]*"adaptiveFormats":\s*\[[^\]]*\][^{}]*\})/,
      /"streamingData":\s*(\{(?:[^{}]|{[^{}]*})*\})/,
      /var ytInitialPlayerResponse = ({.+?});/,
      /window\["ytInitialPlayerResponse"\] = ({.+?});/
    ];

    for (let i = 0; i < alternativePatterns.length; i++) {
      const match = htmlYouTubePage.match(alternativePatterns[i]);
      if (match) {
        console.log(`getVideoData: Found alternative pattern ${i}:`, match[1].substring(0, 100) + "...");

        // Check if this pattern contains URLs
        if (match[1].includes('"url"') && match[1].includes("https://")) {
          console.log(`getVideoData: Pattern ${i} contains URLs! Using this as streaming data source`);
          try {
            const parsedData = JSON.parse(match[1]);

            // Check if this is direct streaming data or a full player response
            if (parsedData.adaptiveFormats) {
              // This is direct streaming data
              streamingDataWithUrls = { streamingData: parsedData };
              console.log("getVideoData: Successfully parsed direct streaming data");
            } else if (parsedData.streamingData) {
              // This is a full player response
              streamingDataWithUrls = parsedData;
              console.log("getVideoData: Successfully parsed full player response");
            } else {
              console.log("getVideoData: Parsed data doesn't contain expected streaming structure");
              continue;
            }
            console.log("getVideoData: Alternative data keys:", Object.keys(streamingDataWithUrls));
            console.log(
              "getVideoData: Has adaptiveFormats?",
              !!streamingDataWithUrls.streamingData?.adaptiveFormats
            );
            console.log("getVideoData: Has formats?", !!streamingDataWithUrls.streamingData?.formats);
            console.log("getVideoData: Has streamingData?", !!streamingDataWithUrls.streamingData);
            if (streamingDataWithUrls.streamingData) {
              console.log(
                "getVideoData: streamingData keys:",
                Object.keys(streamingDataWithUrls.streamingData)
              );
              console.log(
                "getVideoData: Has streamingData.adaptiveFormats?",
                !!streamingDataWithUrls.streamingData.adaptiveFormats
              );
              console.log(
                "getVideoData: Has streamingData.formats?",
                !!streamingDataWithUrls.streamingData.formats
              );
            }
            if (streamingDataWithUrls.streamingData?.adaptiveFormats) {
              console.log(
                "getVideoData: Alternative adaptiveFormats count:",
                streamingDataWithUrls.streamingData.adaptiveFormats.length
              );
            }
            if (streamingDataWithUrls.streamingData?.formats) {
              console.log(
                "getVideoData: Alternative formats count:",
                streamingDataWithUrls.streamingData.formats.length
              );
            }
            break;
          } catch (error) {
            console.log(`getVideoData: Failed to parse pattern ${i}:`, error);
          }
        }
      }
    }
  }

  // Extract video data with better error handling and logging
  const videoDataMatch = htmlYouTubePage.match(gRegex.videoData);
  if (!videoDataMatch) {
    console.error("getVideoData: Failed to match ytInitialPlayerResponse regex");
    console.log("getVideoData: HTML page length:", htmlYouTubePage.length);
    console.log("getVideoData: First 500 chars:", htmlYouTubePage.substring(0, 500));
    throw new Error("Could not extract video data from YouTube page");
  }

  console.log("getVideoData: Successfully matched ytInitialPlayerResponse");
  console.log("getVideoData: Raw video data length:", videoDataMatch[1].length);
  console.log("getVideoData: Raw video data first 500 chars:", videoDataMatch[1].substring(0, 500));

  // Check if raw data contains streaming URLs before parsing
  console.log("getVideoData: Checking raw data for URL patterns...");
  console.log('- Contains "url":', videoDataMatch[1].includes('"url"'));
  console.log('- Contains "signatureCipher":', videoDataMatch[1].includes('"signatureCipher"'));
  console.log('- Contains "cipher":', videoDataMatch[1].includes('"cipher"'));
  console.log('- Contains "https://":', videoDataMatch[1].includes("https://"));
  console.log('- Contains "adaptiveFormats":', videoDataMatch[1].includes('"adaptiveFormats"'));

  let videoData: PlayerResponse;
  try {
    videoData = JSON.parse(videoDataMatch[1]);
    console.log("getVideoData: Successfully parsed video data JSON");
    console.log("getVideoData: Video title:", videoData.videoDetails?.title);
    console.log("getVideoData: Video ID:", videoData.videoDetails?.videoId);
  } catch (error) {
    console.error("getVideoData: Failed to parse video data JSON:", error);
    console.log("getVideoData: Raw JSON data:", videoDataMatch[1].substring(0, 200) + "...");
    throw new Error("Could not parse video data JSON");
  }

  const playabilityStatus = videoData.playabilityStatus?.status;
  console.log("getVideoData: Playability status:", playabilityStatus);

  const isUnplayable = playabilityStatus !== "OK";
  if (isUnplayable) {
    console.warn("getVideoData: Video is unplayable, reason:", videoData.playabilityStatus?.reason);
    return videoData;
  }

  // If we found alternative streaming data with URLs, use that instead
  console.log("getVideoData: Checking alternative streaming data usage...");
  console.log("getVideoData: streamingDataWithUrls exists?", !!streamingDataWithUrls);
  if (streamingDataWithUrls) {
    console.log("getVideoData: streamingDataWithUrls keys:", Object.keys(streamingDataWithUrls));
    console.log("getVideoData: has adaptiveFormats?", !!streamingDataWithUrls.streamingData?.adaptiveFormats);
    console.log("getVideoData: has streamingData?", !!streamingDataWithUrls.streamingData);
    if (streamingDataWithUrls.streamingData) {
      console.log(
        "getVideoData: has streamingData.adaptiveFormats?",
        !!streamingDataWithUrls.streamingData.adaptiveFormats
      );
    }
  }

  if (
    streamingDataWithUrls &&
    streamingDataWithUrls.streamingData &&
    (streamingDataWithUrls.streamingData.adaptiveFormats || streamingDataWithUrls.streamingData.formats)
  ) {
    console.log("getVideoData: Using alternative streaming data with URLs");

    // Debug both format arrays
    if (streamingDataWithUrls.streamingData.formats) {
      console.log(
        "getVideoData: Alternative formats count:",
        streamingDataWithUrls.streamingData.formats.length
      );
      const firstFormat = streamingDataWithUrls.streamingData.formats[0];
      console.log("getVideoData: First format properties:", Object.keys(firstFormat));
      console.log("getVideoData: First format has url?", !!firstFormat.url);
      console.log(
        "getVideoData: First format url:",
        firstFormat.url ? firstFormat.url.substring(0, 100) + "..." : "undefined"
      );
    }

    if (streamingDataWithUrls.streamingData.adaptiveFormats) {
      console.log(
        "getVideoData: Alternative adaptiveFormats count:",
        streamingDataWithUrls.streamingData.adaptiveFormats.length
      );
      const firstAltFormat = streamingDataWithUrls.streamingData.adaptiveFormats[0];
      console.log("getVideoData: First alternative format properties:", Object.keys(firstAltFormat));
      console.log("getVideoData: First alternative format has url?", !!firstAltFormat.url);
      console.log(
        "getVideoData: First alternative format url:",
        firstAltFormat.url ? firstAltFormat.url.substring(0, 100) + "..." : "undefined"
      );
    }

    // Replace the formats with the ones that have URLs
    if (!videoData.streamingData) {
      videoData.streamingData = {
        expiresInSeconds: streamingDataWithUrls.streamingData.expiresInSeconds || "21600",
        formats: [],
        adaptiveFormats: []
      };
    }

    // Replace adaptiveFormats if they exist and have URLs
    if (streamingDataWithUrls.streamingData.adaptiveFormats) {
      videoData.streamingData.adaptiveFormats = streamingDataWithUrls.streamingData.adaptiveFormats;
    }

    // Replace regular formats if they exist and have URLs
    if (streamingDataWithUrls.streamingData.formats) {
      videoData.streamingData.formats = streamingDataWithUrls.streamingData.formats;
    }

    // Debug: Verify the replacement worked
    if (videoData.streamingData.adaptiveFormats && videoData.streamingData.adaptiveFormats.length > 0) {
      const firstReplacedFormat = videoData.streamingData.adaptiveFormats[0];
      console.log(
        "getVideoData: After replacement - first adaptiveFormat properties:",
        Object.keys(firstReplacedFormat)
      );
      console.log(
        "getVideoData: After replacement - first adaptiveFormat has url?",
        !!firstReplacedFormat.url
      );
      console.log(
        "getVideoData: After replacement - first adaptiveFormat url:",
        firstReplacedFormat.url ? firstReplacedFormat.url.substring(0, 100) + "..." : "undefined"
      );
    }

    if (videoData.streamingData.formats && videoData.streamingData.formats.length > 0) {
      const firstReplacedFormat = videoData.streamingData.formats[0];
      console.log(
        "getVideoData: After replacement - first format properties:",
        Object.keys(firstReplacedFormat)
      );
      console.log("getVideoData: After replacement - first format has url?", !!firstReplacedFormat.url);
      console.log(
        "getVideoData: After replacement - first format url:",
        firstReplacedFormat.url ? firstReplacedFormat.url.substring(0, 100) + "..." : "undefined"
      );
    }

    console.log("getVideoData: Successfully replaced formats with URL-enabled versions");
    return videoData;
  }

  const formats = videoData.streamingData?.adaptiveFormats || videoData.streamingData?.formats;
  console.log("getVideoData: Found formats count:", formats?.length || 0);

  if (!formats || formats.length === 0) {
    console.warn("getVideoData: No streaming formats found");
    return videoData;
  }

  console.log("getVideoData: First format details:", {
    hasUrl: !!formats[0]?.url,
    url: formats[0]?.url,
    hasSignatureCipher: !!(formats[0] as Record<string, unknown>)?.["signatureCipher"],
    signatureCipher: (formats[0] as Record<string, unknown>)?.["signatureCipher"]
  });

  // Debug: Log all properties of the first format to see what's available
  console.log("getVideoData: First format all properties:", Object.keys(formats[0] || {}));
  console.log("getVideoData: First format complete object:", formats[0]);

  // Check for alternative property names YouTube might use for URLs
  const firstFormat = formats[0] as Record<string, unknown>;
  console.log("getVideoData: Looking for URL-related properties:");
  console.log("- url:", firstFormat.url);
  console.log("- signatureCipher:", firstFormat.signatureCipher);
  console.log("- cipher:", firstFormat.cipher);
  console.log("- streamingUrl:", firstFormat.streamingUrl);
  console.log("- baseUrl:", firstFormat.baseUrl);
  console.log("- audioUrl:", firstFormat.audioUrl);

  const isHasStreamingUrls = Boolean(
    formats[0]?.url && formats[0].url !== "null&null=" && formats[0].url.startsWith("http")
  );
  console.log("getVideoData: Has streaming URLs:", isHasStreamingUrls);

  if (isHasStreamingUrls) {
    console.log("getVideoData: Using direct streaming URLs");
    videoData.streamingData.adaptiveFormats = await getDownloadableLinks(formats);
    return videoData;
  }

  // Extract player data with better error handling and logging
  console.log("getVideoData: Need to decipher signatures, extracting player data");
  const playerDataMatch = htmlYouTubePage.match(gRegex.playerData);
  if (!playerDataMatch) {
    console.error("getVideoData: Failed to match player data regex");
    console.log("getVideoData: Searching for player data patterns in HTML...");
    throw new Error("Could not extract player data from YouTube page");
  }

  console.log("getVideoData: Successfully matched player data");

  let playerData;
  try {
    playerData = JSON.parse(playerDataMatch[1]);
    console.log("getVideoData: Successfully parsed player data JSON");
    console.log("getVideoData: Player JS URL:", playerData.PLAYER_JS_URL);
  } catch (error) {
    console.error("getVideoData: Failed to parse player data JSON:", error);
    console.log("getVideoData: Raw player data:", playerDataMatch[1].substring(0, 200) + "...");
    throw new Error("Could not parse player data JSON");
  }

  console.log("getVideoData: Starting adaptive formats extraction with signature deciphering");
  videoData.streamingData.adaptiveFormats = await getAdaptiveFormats({
    videoData,
    playerData
  });

  console.log(
    "getVideoData: Successfully extracted video data with",
    videoData.streamingData.adaptiveFormats?.length || 0,
    "adaptive formats"
  );

  return videoData;
}
