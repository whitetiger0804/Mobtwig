package com.mobtwig.review;

import com.mobtwig.auth.MemberSessions;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** 회원·작품·리뷰·댓글 순서로 잠근 뒤 공감과 신고를 중복 없이 저장합니다. */
@Service
class ReviewEngagementService {
    record LikeState(long likeCount, boolean liked) {}
    record Report(String id, boolean reported) {}
    record ReportResult(Report report, boolean created) {}

    private final ReviewEngagementRepository engagement;
    private final MemberSessions members;

    ReviewEngagementService(ReviewEngagementRepository engagement, MemberSessions members) {
        this.engagement = engagement;
        this.members = members;
    }

    /** 공감 상태를 설정하고 실제 저장된 공감 수를 반환합니다. */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public LikeState like(long target, long member, boolean comment, boolean liked) {
        lockOtherMemberTarget(target, member, comment);
        if (liked) {
            if (!engagement.liked(target, member, comment)) engagement.insertLike(target, member, comment);
        } else {
            engagement.deleteLike(target, member, comment);
        }
        return new LikeState(engagement.likeCount(target, comment), liked);
    }

    /** 최초 신고를 보존하며 중복 요청에는 기존 신고 식별자만 반환합니다. */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public ReportResult report(long target, long member, boolean comment, String reason, String detail) {
        lockOtherMemberTarget(target, member, comment);
        var existing = engagement.reportId(target, member, comment);
        if (existing.isPresent()) return new ReportResult(new Report(existing.get().toString(), true), false);
        long id = engagement.insertReport(target, member, comment, reason, detail);
        return new ReportResult(new Report(Long.toString(id), true), true);
    }

    private void lockOtherMemberTarget(long target, long member, boolean comment) {
        members.lockActiveMember(member);
        var parent = engagement.parent(target, comment).orElseThrow(ReviewEngagementService::notFound);
        if (!engagement.lockPublishedBook(parent.book())) throw notFound();
        long owner = engagement.lockReview(parent.review(), parent.book(), !comment)
                .orElseThrow(ReviewEngagementService::notFound);
        if (comment) owner = engagement.lockComment(target, parent.review())
                .orElseThrow(ReviewEngagementService::notFound);
        if (owner == member) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                "본인의 리뷰나 댓글에는 공감하거나 신고할 수 없습니다.");
    }

    private static ResponseStatusException notFound() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "공개된 리뷰나 댓글이 없습니다.");
    }
}
