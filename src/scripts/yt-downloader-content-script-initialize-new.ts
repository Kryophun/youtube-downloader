import type { PlayerResponse } from "./types";
import { handleVideo } from "./yt-downloader-content-script-video";

export const gPorts = {
  main: null,
  processSingle: null,
  processPlaylist: null
};

export const gCancelControllers: AbortController[] = [];

export function getIsDownloadable({ streamingData }: PlayerResponse): boolean {
  if (!streamingData) {
    return false;
  }
  return streamingData.adaptiveFormats.length > 0;
}

// Add message listener for background script communication
console.log(`Adding listener for video message...`);
chrome.runtime.onMessage.addListener(message => {
  if (message.action === "handleVideo") {
    console.log("Received handleVideo message from background script");
    handleVideo().catch(error => {
      console.error("Error handling video from background message:", error);
    });
    return true; // Indicate we will respond asynchronously
  }
});
