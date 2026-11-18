package com.mobtwig.library;

import java.util.List;
import com.mobtwig.library.WorkFollowRepository.Kind;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class WorkFollowService {
    private final WorkFollowRepository repository;

    WorkFollowService(WorkFollowRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public State state(long member, String slug) {
        return repository.state(member, work(slug, false));
    }

    @Transactional
    public State change(long member, String slug, Kind kind, boolean present) {
        var work = work(slug, true);
        if (kind == Kind.SUBSCRIPTION && !work.webnovel()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "웹소설만 구독할 수 있습니다.");
        }
        repository.change(member, work.id(), kind, present);
        return repository.state(member, work);
    }

    @Transactional(readOnly = true)
    public Favorites favorites(long member, int page, int size) {
        var items = repository.favorites(member, (page - 1L) * size, size + 1);
        return new Favorites(items.stream().limit(size).toList(), page, items.size() > size);
    }

    private WorkFollowRepository.Work work(String slug, boolean lock) {
        if (!slug.matches("[a-z0-9-]{1,120}")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "작품 식별자를 확인해 주세요.");
        }
        return repository.publishedWork(slug, lock)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "공개 작품을 찾을 수 없습니다."));
    }

    public record State(boolean favorite, boolean subscribed) { }
    public record Favorite(String id, String title, String imageUrl, String kind) { }
    public record Favorites(List<Favorite> items, int page, boolean hasNext) { }
}
