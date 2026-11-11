package com.mobtwig.reader;

import java.time.Instant;
import java.util.List;

import com.mobtwig.work.WorkMetadata;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** 회원 본인의 최근 본 작품을 공개 작품 기준으로 조회·기록합니다. */
@Service
public class RecentWorksService {
    private final RecentWorksRepository repository;
    private final ReadingProgressRepository members;

    public RecentWorksService(RecentWorksRepository repository, ReadingProgressRepository members) {
        this.repository = repository;
        this.members = members;
    }

    @Transactional(readOnly = true)
    public List<RecentWorkResponse> list(long member) {
        return repository.list(member).stream().map(RecentWorksService::response).toList();
    }

    @Transactional
    public void view(long member, String slug) {
        if (slug == null || slug.length() > 120 || !slug.matches("[a-z0-9-]+")) throw RecentWorkFailure.invalid();
        // 읽기 위치 저장과 같은 순서로 회원 행을 먼저 잠급니다.
        if (!members.lockActiveMember(member)) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        long book = repository.publishedBook(slug).orElseThrow(RecentWorkFailure::notFound);
        repository.upsert(member, book, Instant.now());
    }

    private static RecentWorkResponse response(RecentWorksRepository.Row row) {
        return new RecentWorkResponse(WorkMetadata.slug(row.slug()), WorkMetadata.requiredText(row.title(), "제목"),
                WorkMetadata.imageUrl(row.imageUrl()), WorkMetadata.kind(row.contentType()), row.lastViewedAt().toString());
    }
}
