/**
 * LinkedIn publisher — publish posts via LinkedIn Marketing API.
 */

import { logger } from "../../lib/logger.js";

export interface LinkedInPublishOptions {
  accessToken: string;
  personUrn: string; // Format: urn:li:person:XXXXX
  content: string;
  mediaUrl?: string;
  title?: string;
  description?: string;
}

interface LinkedInPublishResult {
  success: boolean;
  postId?: string;
  error?: string;
}

/**
 * Register an image upload with LinkedIn.
 */
async function registerImageUpload(
  accessToken: string,
  personUrn: string
): Promise<{ uploadUrl: string; imageUrn: string }> {
  const response = await fetch("https://api.linkedin.com/v2/assets?action=registerUpload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify({
      registerUploadRequest: {
        recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
        owner: personUrn,
        serviceRelationships: [
          {
            relationshipType: "OWNER",
            identifier: "urn:li:userGeneratedContent",
          },
        ],
      },
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`LinkedIn image registration failed: ${error}`);
  }

  const data = (await response.json()) as {
    value: {
      uploadMechanism: {
        "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest": {
          uploadUrl: string;
        };
      };
      asset: string;
    };
  };

  return {
    uploadUrl:
      data.value.uploadMechanism["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"]
        .uploadUrl,
    imageUrn: data.value.asset,
  };
}

/**
 * Upload image to LinkedIn.
 */
async function uploadImage(uploadUrl: string, imageUrl: string): Promise<void> {
  const imageResponse = await fetch(imageUrl, {
    signal: AbortSignal.timeout(30000),
  });
  if (!imageResponse.ok) {
    throw new Error(`Failed to download image: ${imageResponse.status}`);
  }

  const imageBlob = await imageResponse.blob();

  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "application/octet-stream",
    },
    body: imageBlob,
    signal: AbortSignal.timeout(60000),
  });

  if (!uploadResponse.ok) {
    const error = await uploadResponse.text();
    throw new Error(`LinkedIn image upload failed: ${error}`);
  }
}

/**
 * Publish to LinkedIn.
 */
export async function publishToLinkedIn(
  options: LinkedInPublishOptions
): Promise<LinkedInPublishResult> {
  try {
    const { accessToken, personUrn, content, mediaUrl, title, description } = options;

    let imageUrn: string | undefined;

    // Upload image if provided
    if (mediaUrl) {
      const { uploadUrl, imageUrn: registeredUrn } = await registerImageUpload(
        accessToken,
        personUrn
      );
      await uploadImage(uploadUrl, mediaUrl);
      imageUrn = registeredUrn;
    }

    // Build the post body
    const body: Record<string, unknown> = {
      author: personUrn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: {
            text: content,
          },
          shareMediaCategory: imageUrn ? "IMAGE" : "NONE",
          ...(imageUrn
            ? {
                media: [
                  {
                    status: "READY",
                    description: { text: description || title || "" },
                    media: imageUrn,
                    title: { text: title || "" },
                  },
                ],
              }
            : {}),
        },
      },
      visibility: {
        "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
      },
    };

    const response = await fetch("https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error({ status: response.status, error }, "LinkedIn publish failed");
      return {
        success: false,
        error: `LinkedIn API error: ${response.status}`,
      };
    }

    // LinkedIn returns 201 with the post ID in the x-restli-id header
    const postId = response.headers.get("x-restli-id") || undefined;

    return { success: true, postId };
  } catch (error) {
    logger.error({ error }, "LinkedIn publish failed");
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
