package com.mobtwig.reader;

import java.time.Instant;
import java.util.List;
import com.mobtwig.reader.ReadingProgressRepository.Work;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** 공개 호와 기사만 조회하며 독서 기록과 조회수에는 접근하지 않습니다. */
@Service
public class MagazineService {
    private final ReadingProgressRepository repository;
    private final MagazinePageSource source;

    public MagazineService(ReadingProgressRepository repository, MagazinePageSource source) {
        this.repository = repository;
        this.source = source;
    }

    @Transactional(readOnly = true)
    public Issue read(String slug) {
        Work work = work(slug);
        var articles = MagazineLayout.ranges(work).stream().filter(range -> range.chapter().visible())
                .map(range -> new Article(Long.toString(range.chapter().id()), range.chapter().title(),
                        range.start(), range.end(), range.chapter().version())).toList();
        return new Issue(work.slug(), work.title(), work.pageCount(), articles);
    }

    @Transactional(readOnly = true)
    public byte[] page(String slug, int page, int version) {
        Work work = work(slug);
        if (page > work.pageCount()) throw notFound();
        var range = MagazineLayout.ranges(work).stream().filter(item -> item.contains(page) && item.chapter().visible())
                .findFirst().orElseThrow(MagazineService::notFound);
        if (version != range.chapter().version()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "매거진 본문이 변경되었습니다. 다시 불러와 주세요.");
        }
        return source.read(range.chapter().url(), page);
    }

    private Work work(String slug) {
        if (slug == null || slug.length() > 120 || !slug.matches("[a-z0-9-]+")) throw invalid();
        var work = repository.work(slug, Instant.now(), false).filter(Work::magazine).orElseThrow(MagazineService::notFound);
        if (work.pageCount() == null || work.pageCount() < 1) throw MagazineLayout.unavailable();
        return work;
    }

    static ResponseStatusException invalid() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "매거진 쪽 요청을 확인해 주세요.");
    }

    private static ResponseStatusException notFound() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "공개된 매거진 쪽이 없습니다.");
    }

    /** 공개 기사만 포함한 매거진 호입니다. */
    public record Issue(String workId, String title, int pageCount, List<Article> articles) { }
    /** 호 기준으로 표시할 공개 기사 쪽 범위입니다. */
    public record Article(String chapterId, String title, int startPage, int endPage, int contentVersion) { }
}
