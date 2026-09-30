"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { getMyProfile, signOut } from "@/lib/data";
import Avatar from "@/components/Avatar";
import PushSettingsCard from "@/components/PushSettingsCard";
import type { Profile } from "@/types";

export default function ProfilePage() {
  const router = useRouter();
  const [me, setMe] = useState<Profile | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const p = await getMyProfile();
      if (!p) {
        router.replace("/login");
        return;
      }
      setMe(p);
    })();
  }, [router]);

  async function handleSave() {
    if (!me) return;
    setSaving(true);
    setError(null);
    try {
      const supabase = getSupabaseBrowserClient();

      if (file) {
        // valida tamanho (máx 2MB)
        if (file.size > 2 * 1024 * 1024) {
          setError("Foto muito grande — usa uma até 2MB. 🦫");
          setSaving(false);
          return;
        }
        const ext = file.name.split(".").pop() || "jpg";
        const path = `${me.id}/avatar.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("avatars")
          .upload(path, file, { upsert: true, contentType: file.type });
        if (upErr) throw upErr;

        const { data } = supabase.storage.from("avatars").getPublicUrl(path);
        // bust cache: timestamp na URL
        const publicUrl = `${data.publicUrl}?t=${Date.now()}`;

        const { error: dbErr } = await supabase
          .from("profiles")
          .update({ avatar_url: publicUrl })
          .eq("id", me.id);
        if (dbErr) throw dbErr;
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError("Não foi possível salvar a foto. Tenta de novo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col bg-capy-sand">
      <header className="flex items-center gap-3 bg-capy-dark px-3 py-2.5 text-white">
        <button
          onClick={() => router.push("/chat")}
          className="rounded-lg p-1.5 hover:bg-white/10"
          aria-label="Voltar"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
        </button>
        <h1 className="font-bold">Meu perfil</h1>
      </header>

      <div className="mx-auto w-full max-w-md flex-1 p-6">
        <div className="flex flex-col items-center gap-4 rounded-2xl bg-white p-6 shadow-lg ring-1 ring-capy-fur/10">
          <div className="relative">
            <Avatar
              profile={me ? { ...me, avatar_url: preview ?? me.avatar_url } : null}
              size={112}
              ring
            />
          </div>
          <p className="text-xl font-extrabold text-capy-dark">
            {me ? `${me.first_name} ${me.last_name}` : "…"}
          </p>
          <p className="text-sm text-capy-dark/60">{me?.email}</p>
          {me?.handle && (
            <p className="rounded-full bg-capy-bubble px-3 py-1 text-sm font-semibold text-capy-deep">
              @{me.handle}
            </p>
          )}

          <label className="mt-2 w-full cursor-pointer rounded-xl border-2 border-dashed border-capy-fur/40 px-4 py-6 text-center text-sm text-capy-dark/60 transition hover:border-capy-green hover:text-capy-green">
            {file ? `📷 ${file.name}` : "Escolher foto de perfil (até 2MB)"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                setPreview(f ? URL.createObjectURL(f) : null);
              }}
            />
          </label>

          {error && (
            <p className="rounded-lg bg-capy-danger/10 px-3 py-2 text-sm text-capy-danger">{error}</p>
          )}
          {saved && (
            <p className="rounded-lg bg-capy-green/10 px-3 py-2 text-sm text-capy-deep">
              Salvo! 🌿
            </p>
          )}

          <button onClick={handleSave} disabled={saving || !file} className="capy-btn w-full">
            {saving ? "Salvando…" : "Salvar foto"}
          </button>
        </div>

        {/* notificações — config fácil aqui embaixo */}
        <PushSettingsCard />

        <div className="mt-6 flex justify-between gap-3">
          <Link href="/chat" className="capy-btn-secondary flex-1 text-center">
            Voltar pro chat
          </Link>
          <button
            onClick={async () => {
              await signOut();
              router.replace("/login");
            }}
            className="flex-1 rounded-xl bg-capy-danger/10 px-4 py-3 font-semibold text-capy-danger transition hover:bg-capy-danger/20"
          >
            Sair
          </button>
        </div>
      </div>
    </main>
  );
}
