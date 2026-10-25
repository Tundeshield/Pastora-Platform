import { useQueryClient } from "@tanstack/react-query";
import {
  getGetPostQueryKey,
  getGetPublicBlogQueryKey,
  getGetPublicPostQueryKey,
  getListPostsQueryKey,
  updatePost,
  useCreatePost,
  useDeletePost,
  useGetPost,
  useGetPublicBlog,
  useGetPublicPost,
  useListPosts,
  useUpdatePost,
  type Post,
  type PostSummary,
  type PublicBlogChurch,
} from "@workspace/api-client-react";
import { ArrowLeft, ArrowRight, Check, Copy, ExternalLink, Globe, PenLine, Plus, Share2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useParams } from "wouter";

import { useSession } from "@/auth";
import { PastoraMark } from "@/components/logo";
import { RichTextEditor, SafeHtml } from "@/components/rich-text";
import { Badge, Button, EmptyState, ErrorPanel, MutationError, PageHeading, SkeletonRows } from "@/components/ui-kit";
import { apiErrorMessage } from "@/firebase-auth";
import { useAutosave } from "@/hooks/use-autosave";

const blogUrl = (slug: string) => `${window.location.origin}/blog/${slug}`;
const postUrl = (slug: string, id: string) => `${blogUrl(slug)}/${id}`;
const longDate = (value: string | null) =>
  value ? new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "";

function CopyButton({ text, label = "Copy link" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      onClick={() =>
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1800);
        })
      }
    >
      {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied" : label}
    </Button>
  );
}

/* ------------------------------------------------------------- Workspace ---- */

export function BlogPage() {
  const session = useSession();
  const slug = session.data?.church?.slug ?? "";
  const list = useListPosts({ query: { queryKey: getListPostsQueryKey(), retry: 1 } });
  const create = useCreatePost();
  const [, setLocation] = useLocation();
  const [filter, setFilter] = useState<"all" | "draft" | "published">("all");

  const posts = list.data ?? [];
  const shown = posts.filter((p) => filter === "all" || p.status === filter);
  return (
    <>
      <PageHeading
        eyebrow="Pastor's blog"
        title="Blog"
        subtitle="Devotionals and reflections for your church to read and pass on."
        action={
          <Button
            disabled={create.isPending}
            onClick={() =>
              create.mutate({ data: { title: "Untitled post" } }, { onSuccess: (p) => setLocation(`/app/blog/${p.id}`) })
            }
          >
            <Plus size={16} /> New post
          </Button>
        }
      />
      {slug && (
        <div className="blog-address">
          <Globe size={17} />
          <div>
            <b>Your blog's public page</b>
            <small>{blogUrl(slug)}</small>
          </div>
          <CopyButton text={blogUrl(slug)} />
          <a className="button outline" href={`/blog/${slug}`} target="_blank" rel="noreferrer">
            <ExternalLink size={15} /> Open
          </a>
        </div>
      )}
      <MutationError errors={[create.error]} />
      {list.isLoading ? (
        <SkeletonRows />
      ) : list.isError ? (
        <ErrorPanel text={apiErrorMessage(list.error, "Posts are unavailable.")} retry={() => void list.refetch()} />
      ) : posts.length === 0 ? (
        <EmptyState
          title="Your first post is waiting"
          description="Write a devotional or a reflection. Drafts are private to you until you publish them."
        />
      ) : (
        <>
          <div className="message-filters" role="tablist" aria-label="Filter posts" style={{ marginBottom: 12 }}>
            {(["all", "draft", "published"] as const).map((f) => (
              <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}>
                {f === "all" ? "All" : f === "draft" ? "Drafts" : "Published"}{" "}
                <span>{f === "all" ? posts.length : posts.filter((p) => p.status === f).length}</span>
              </button>
            ))}
          </div>
          {shown.length ? (
            <div className="message-list">
              {shown.map((p) => (
                <PostRow key={p.id} post={p} />
              ))}
            </div>
          ) : (
            <EmptyState title="Nothing here" description="No posts match this filter." />
          )}
        </>
      )}
    </>
  );
}

function PostRow({ post: p }: { post: PostSummary }) {
  return (
    <Link href={`/app/blog/${p.id}`} className="message-row">
      <span className="message-row-icon">
        <PenLine size={16} />
      </span>
      <div>
        <b>{p.title}</b>
        <small>{p.excerpt || "No words yet"}</small>
      </div>
      <span className="message-row-meta">
        <Badge label={p.status === "published" ? "Published" : "Draft"} />
        <small>
          {p.isMine ? "" : `${p.authorName} · `}
          {p.status === "published" ? longDate(p.publishedAt) : `edited ${new Date(p.updatedAt).toLocaleDateString()}`}
        </small>
      </span>
    </Link>
  );
}

export function PostEditorPage() {
  const { id = "" } = useParams<{ id: string }>();
  const post = useGetPost(id, { query: { queryKey: getGetPostQueryKey(id), retry: 1 } });
  if (post.isLoading) return <SkeletonRows />;
  if (post.isError || !post.data) {
    return <ErrorPanel text={apiErrorMessage(post.error, "This post couldn't be opened.")} retry={() => void post.refetch()} />;
  }
  return post.data.isMine ? <PostEditor key={id} initial={post.data} /> : <PostReader post={post.data} />;
}

/** Another pastor's published post: read-only. */
function PostReader({ post }: { post: Post }) {
  return (
    <div className="message-editor">
      <div className="editor-bar">
        <Link href="/app/blog" className="under-link">
          <ArrowLeft size={15} /> All posts
        </Link>
      </div>
      <h1 className="serif editor-title">{post.title}</h1>
      <p className="role-help">
        By {post.authorName} · published {longDate(post.publishedAt)}. Only the author can edit it.
      </p>
      <SafeHtml html={post.body} />
    </div>
  );
}

function PostEditor({ initial }: { initial: Post }) {
  const qc = useQueryClient();
  const session = useSession();
  const slug = session.data?.church?.slug ?? "";
  const [, setLocation] = useLocation();
  const [draft, setDraft] = useState({ title: initial.title, scripture: initial.scripture ?? "", body: initial.body });
  const [status, setStatus] = useState(initial.status);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const publish = useUpdatePost();
  const remove = useDeletePost();

  const autosave = useAutosave<{ title: string; scripture: string | null; body: string }>(async (changes) => {
    const saved = await updatePost(initial.id, changes);
    qc.setQueryData(getGetPostQueryKey(initial.id), saved);
    void qc.invalidateQueries({ queryKey: getListPostsQueryKey() });
  });
  const edit = (changes: Partial<typeof draft>) => {
    setDraft((d) => ({ ...d, ...changes }));
    autosave.queue(changes);
  };

  const setPublished = async (next: "draft" | "published") => {
    await autosave.flush();
    publish.mutate(
      { postId: initial.id, data: { status: next } },
      {
        onSuccess: (saved) => {
          setStatus(saved.status);
          qc.setQueryData(getGetPostQueryKey(initial.id), saved);
          void qc.invalidateQueries({ queryKey: getListPostsQueryKey() });
        },
      },
    );
  };

  return (
    <div className="message-editor">
      <div className="editor-bar">
        <Link href="/app/blog" className="under-link">
          <ArrowLeft size={15} /> All posts
        </Link>
        <span className={`save-state ${autosave.state}`} role="status">
          {autosave.label}
          {autosave.state === "error" && (
            <button className="plain-link" onClick={() => void autosave.flush()}>
              Retry
            </button>
          )}
        </span>
        <div className="editor-actions">
          <Badge label={status === "published" ? "Published" : "Draft"} />
          {status === "published" ? (
            <Button variant="outline" disabled={publish.isPending} onClick={() => void setPublished("draft")}>
              Unpublish
            </Button>
          ) : (
            <Button disabled={publish.isPending} onClick={() => void setPublished("published")}>
              <Globe size={15} /> Publish
            </Button>
          )}
        </div>
      </div>
      {status === "published" && slug && (
        <div className="blog-address">
          <Check size={17} />
          <div>
            <b>Published. Anyone with the link can read it.</b>
            <small>{postUrl(slug, initial.id)}</small>
          </div>
          <CopyButton text={postUrl(slug, initial.id)} />
          <a className="button outline" href={`/blog/${slug}/${initial.id}`} target="_blank" rel="noreferrer">
            <ExternalLink size={15} /> View
          </a>
        </div>
      )}
      <MutationError errors={[publish.error]} />

      <input
        className="editor-title serif"
        aria-label="Title"
        maxLength={200}
        value={draft.title}
        placeholder="Post title"
        onChange={(e) => edit({ title: e.target.value })}
      />
      <div className="editor-meta" style={{ gridTemplateColumns: "1fr" }}>
        <label>
          <span>Scripture (optional)</span>
          <input
            maxLength={300}
            placeholder="e.g. Lamentations 3:22-23"
            value={draft.scripture}
            onChange={(e) => edit({ scripture: e.target.value })}
          />
        </label>
      </div>
      <RichTextEditor
        className="editor-body"
        label="Post"
        placeholder="Write your devotional or reflection…"
        value={draft.body}
        onChange={(html) => edit({ body: html })}
      />
      <div className="editor-foot">
        <small>{status === "published" ? "Edits to a published post appear on the public page as you save." : "Draft: only you can see it."}</small>
        {confirmDelete ? (
          <span className="editor-delete">
            Delete this post for good?
            <Button
              variant="outline"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(
                  { postId: initial.id },
                  {
                    onSuccess: () => {
                      autosave.discard();
                      void qc.invalidateQueries({ queryKey: getListPostsQueryKey() });
                      setLocation("/app/blog");
                    },
                  },
                )
              }
            >
              Delete
            </Button>
            <Button variant="quiet" onClick={() => setConfirmDelete(false)}>
              Keep
            </Button>
          </span>
        ) : (
          <button className="plain-link" onClick={() => setConfirmDelete(true)}>
            Delete post
          </button>
        )}
      </div>
      <MutationError errors={[remove.error]} />
    </div>
  );
}

/* ----------------------------------------------------------- Public pages ---- */

function PublicBlogFrame({ church, children }: { church?: PublicBlogChurch; children: ReactNode }) {
  return (
    <div className="public-blog">
      <header className="public-blog-top">
        {church ? (
          <Link href={`/blog/${church.slug}`} className="public-blog-name serif">
            {church.name}
          </Link>
        ) : (
          <span />
        )}
        {church?.careEnabled && (
          <a className="under-link" href={`/care/${church.slug}`}>
            Need prayer or a conversation? <ArrowRight size={14} />
          </a>
        )}
      </header>
      <main className="public-blog-main">{children}</main>
      <footer className="public-blog-foot">
        <a href="/" className="powered-by">
          <PastoraMark size={18} /> Powered by Pastora
        </a>
      </footer>
    </div>
  );
}

function Unavailable() {
  return (
    <PublicBlogFrame>
      <div className="portal-error">
        <h1 className="serif">This page isn't available.</h1>
        <p>The blog may have moved, or the post may no longer be published.</p>
      </div>
    </PublicBlogFrame>
  );
}

export function PublicBlogPage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const blog = useGetPublicBlog(slug, { query: { queryKey: getGetPublicBlogQueryKey(slug), retry: 1 } });
  useEffect(() => {
    if (blog.data) document.title = `${blog.data.church.name} · Blog`;
  }, [blog.data]);
  if (blog.isLoading) return <PublicBlogFrame><SkeletonRows /></PublicBlogFrame>;
  if (blog.isError || !blog.data) return <Unavailable />;
  const { church, posts } = blog.data;
  return (
    <PublicBlogFrame church={church}>
      <div className="public-blog-intro">
        <p className="eyebrow">From the pastor</p>
        <h1 className="serif">Words for the week</h1>
      </div>
      {posts.length ? (
        <div className="public-post-list">
          {posts.map((p) => (
            <Link key={p.id} href={`/blog/${church.slug}/${p.id}`} className="public-post-card">
              <small>
                {longDate(p.publishedAt)}
                {p.scripture ? ` · ${p.scripture}` : ""}
              </small>
              <h2 className="serif">{p.title}</h2>
              <p>{p.excerpt}</p>
              <span className="under-link">
                Read <ArrowRight size={14} />
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState title="Nothing published yet" description="New posts from the pastor will appear here." />
      )}
    </PublicBlogFrame>
  );
}

export function PublicPostPage() {
  const { slug = "", postId = "" } = useParams<{ slug: string; postId: string }>();
  const page = useGetPublicPost(slug, postId, { query: { queryKey: getGetPublicPostQueryKey(slug, postId), retry: 1 } });
  useEffect(() => {
    if (page.data) document.title = `${page.data.post.title} · ${page.data.church.name}`;
  }, [page.data]);
  if (page.isLoading) return <PublicBlogFrame><SkeletonRows /></PublicBlogFrame>;
  if (page.isError || !page.data) return <Unavailable />;
  const { church, post } = page.data;
  const url = postUrl(church.slug, post.id);
  const share = () => {
    if (navigator.share) void navigator.share({ title: post.title, url }).catch(() => undefined);
  };
  return (
    <PublicBlogFrame church={church}>
      <article className="public-post">
        <Link href={`/blog/${church.slug}`} className="under-link">
          <ArrowLeft size={14} /> All posts
        </Link>
        <h1 className="serif">{post.title}</h1>
        <p className="public-post-meta">
          {post.authorName} · {longDate(post.publishedAt)}
        </p>
        {post.scripture && <p className="public-post-scripture">{post.scripture}</p>}
        <SafeHtml className="public-post-body" html={post.body} />
        <div className="public-post-share">
          <span>Share this</span>
          <a
            className="button outline"
            href={`https://wa.me/?text=${encodeURIComponent(`${post.title} ${url}`)}`}
            target="_blank"
            rel="noreferrer"
          >
            WhatsApp
          </a>
          <CopyButton text={url} />
          {typeof navigator !== "undefined" && "share" in navigator && (
            <Button variant="outline" onClick={share}>
              <Share2 size={15} /> More
            </Button>
          )}
        </div>
      </article>
    </PublicBlogFrame>
  );
}
