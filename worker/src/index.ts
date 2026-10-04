import photoIds from './photo-ids.json';
import campus from './submission-campus.json';
import { handleLikes } from './likes.mjs';
import { handleSubmissions, cleanupSubmissions } from './submissions.mjs';
const publishedPhotos = new Set(photoIds);
export default {
  fetch(request, env) {
    return new URL(request.url).pathname.startsWith('/api/submissions/')
      ? handleSubmissions(request, env, campus) : handleLikes(request, env, publishedPhotos);
  },
  async scheduled(_event, env) { await cleanupSubmissions(env); }
} satisfies ExportedHandler<Env>;
