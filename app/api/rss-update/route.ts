import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import Parser from "rss-parser"

const parser = new Parser()

import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!,
  {
    auth: {
      persistSession: false,
    },
  }
)

type Entry = {
  guid: string
  link: string
  title: string
  task_id?: string
}

async function fetchRssFeed() {
  const feed = await parser.parseURL(
    "https://folklore-cms.vercel.app/entries.rss"
  )
  return feed.items.map((item) => {
    return {
      link: item.link,
      guid: item.guid,
      title: item.title,
    } as Entry
  })
}

async function getExistingEntries() {
  const { data: entries, error } = await supabase.from("entries").select("*")

  // Throw any errors we receive.
  if (error) {
    throw error
  }

  return entries as Entry[]
}

async function addToDatabase(entry: Entry, taskId: string) {
  console.log(`Adding entry ${entry.guid} to database`)

  await supabase.from("entries").insert({ ...entry, task_id: taskId })
}

async function addToMendable(entry: Entry) {
  console.log(`Adding entry ${entry.guid} to Mendable`)

  const response = await fetch("https://api.mendable.ai/v0/ingestData", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      api_key: process.env.MENDABLE_API_KEY,
      url: entry.link,
      type: "url",
    }),
  })

  if (!response.ok) {
    throw new Error(`Failed to add entry ${entry.guid} to Mendable`)
  }

  console.log(`Added entry ${entry.guid} to Mendable`)

  const data = await response.json()
  return data.task_id
}

export async function GET(request: NextRequest) {
  // Get the existing entries from the database.
  const existing = await getExistingEntries()

  // Get entries from RSS feed.
  const entries = await fetchRssFeed()

  // Get entries that are to be ingested into Mendable and the database.
  const pending = entries.filter((entry) => {
    return !existing.find((e) => e.guid === entry.guid)
  })

  // Add the pending entries to Mendable and the database.
  for (const entry of pending) {
    const taskId = await addToMendable(entry)
    await addToDatabase(entry, taskId)
  }

  return NextResponse.json(
    {
      body: JSON.stringify({
        message: `Inserted ${pending.length} new entries.`,
      }),
      path: request.nextUrl.pathname,
      query: request.nextUrl.search,
      cookies: request.cookies.getAll(),
    },
    {
      status: 200,
    }
  )
}
