package com.mobtwig.community;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** 웹 클라이언트가 고정 스티커 SVG만 교차 출처에서 읽을 수 있게 합니다. */
@Configuration(proxyBeanMethods = false)
class CommunityWebConfiguration implements WebMvcConfigurer {
    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/stickers/**").allowedOrigins("*").allowedMethods("GET").maxAge(600);
    }
}
