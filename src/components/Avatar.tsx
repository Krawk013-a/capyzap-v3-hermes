"use client";

import type { Profile } from "@/types";
import { initials } from "@/lib/format";

export default function Avatar({
  profile,
  group,
  size = 44,
  ring,
}: {
  profile?: Profile | null;
  group?: boolean;
  size?: number;
  ring?: boolean;
}) {
  const label = group
    ? "👥"
    : profile
    ? initials(profile.first_name, profile.last_name)
    : "🌿";
  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-full bg-capy-fur text-white shadow ${
        ring ? "ring-2 ring-capy-green ring-offset-1 ring-offset-capy-sand" : ""
      }`}
      style={{ width: size, height: size }}
    >
      {profile?.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={profile.avatar_url}
          alt={profile.first_name}
          className="h-full w-full object-cover"
        />
      ) : (
        <span
          className="flex h-full w-full items-center justify-center font-bold"
          style={{ fontSize: size * 0.36 }}
        >
          {label}
        </span>
      )}
    </div>
  );
}
