package com.mobtwig.reader;

/** 최근 본 작품 한 건입니다. id는 작품 slug이며 lastReadAt은 UTC ISO 시각입니다. */
public record RecentWorkResponse(String id, String title, String imageUrl, String kind, String lastReadAt) { }
