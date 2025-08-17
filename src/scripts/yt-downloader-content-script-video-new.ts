import { getVideoData } from "./yt-downloader-functions";
import { gCancelControllers, getIsDownloadable } from "./yt-downloader-content-script-initialize";
import { getCompatibleFilename } from "./utils";
import type { PlayerResponse } from "./types";

export async function handleVideo(): Promise<void> {
  console.log(`YT Downloader: handleVideo()`);
  const getHtml = async () => {
    const abortController = new AbortController();
    gCancelControllers.push(abortController);
    console.log(`Fetching html for ${location.href}`);
    const response = await fetch(location.href, {
      signal: abortController.signal
    });
    return response.text();
  };

  const videoData = await getVideoData(await getHtml());
  console.log(`YT Downloader: videoData`, videoData);

  // Skip UI creation and download audio directly
  await downloadAudioDirectly(videoData);
}

async function downloadAudioDirectly(videoData: PlayerResponse): Promise<void> {
  console.log(`YT Downloader: Starting automatic audio download`);

  // Check if video is downloadable
  if (!getIsDownloadable(videoData)) {
    console.log(`YT Downloader: Video is not downloadable`);
    return;
  }

  // Get video details
  const { videoId, title } = videoData.videoDetails;
  console.log(`YT Downloader: Downloading audio for: ${title}`);

  // Find the best audio format (highest bitrate)
  const formats = videoData.streamingData?.adaptiveFormats || [];
  const audioFormats = formats.filter(format => format.mimeType?.startsWith("audio"));

  if (audioFormats.length === 0) {
    console.log(`YT Downloader: No audio formats found`);
    return;
  }

  // Sort by bitrate (highest first) and get the best one
  audioFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  const bestAudio = audioFormats[0];

  console.log(`YT Downloader: Selected audio format:`, {
    bitrate: bestAudio.bitrate,
    mimeType: bestAudio.mimeType,
    url: bestAudio.url ? "Direct URL" : "Needs deciphering"
  });

  // Create filename with .mp3 extension
  const filename = getCompatibleFilename(title);
  const filenameOutput = `${filename}.mp3`;

  console.log(`YT Downloader: Downloading as: ${filenameOutput}`);

  // Send download request to background script
  try {
    // First establish connection to background script
    const port = chrome.runtime.connect({ name: "processSingle" });

    // Send the download request
    port.postMessage({
      type: "audio",
      urls: {
        video: "", // Not needed for audio-only
        audio: bestAudio.url
      },
      filenameOutput: filenameOutput,
      videoId: videoId
    });

    console.log(`YT Downloader: Download request sent successfully`);

    // Show a simple notification
    console.log(`YT Downloader: Starting download of "${filenameOutput}"`);
  } catch (error) {
    console.error(`YT Downloader: Failed to start download:`, error);
  }
}
