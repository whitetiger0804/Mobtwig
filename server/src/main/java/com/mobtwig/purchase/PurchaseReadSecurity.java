package com.mobtwig.purchase;

import java.util.Map;
import java.util.Objects;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Configuration;
import org.jspecify.annotations.NonNull;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.HandlerMapping;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** 기존 공개 본문·PNG 경로로 유료 상품을 우회 열람하지 못하도록 검사합니다. */
@Configuration(proxyBeanMethods = false)
public class PurchaseReadSecurity implements WebMvcConfigurer {
    private final PurchaseService purchases;

    /**
     * 소장 권한 검사기를 주입받습니다.
     * @param purchases 소장 권한 검사기입니다.
     */
    public PurchaseReadSecurity(PurchaseService purchases) { this.purchases = purchases; }

    /**
     * 상품 미설정·무료 자료는 기존 공개 경로를 유지합니다. 유료 본문은 회원 전용 경로를 사용합니다.
     * @param registry 공개 본문에 적용할 인터셉터 목록입니다.
     */
    @Override
    public void addInterceptors(@NonNull InterceptorRegistry registry) {
        registry.addInterceptor(new HandlerInterceptor() {
            @Override
            @SuppressWarnings("unchecked")
            public boolean preHandle(@NonNull HttpServletRequest request, @NonNull HttpServletResponse response, @NonNull Object handler) {
                var variables = (Map<String, String>) Objects.requireNonNull(request.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE));
                String chapter = variables.get("chapterId");
                if (chapter != null && !chapter.matches("-?[1-9][0-9]{0,18}")) throw PurchaseFailure.notFound();
                purchases.requireRead(null, Objects.requireNonNull(variables.get("slug")),
                        chapter == null ? null : PurchaseController.decimal(chapter, true));
                return true;
            }
        }).addPathPatterns("/works/*/chapters/*", "/works/*/magazine/pages/*");
    }
}
