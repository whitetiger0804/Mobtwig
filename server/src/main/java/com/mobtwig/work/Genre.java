package com.mobtwig.work;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/** 작품 장르와 표시 순서를 매핑합니다. */
@Entity
@Table(name = "genre")
public class Genre {
    @Id
    private Long id;

    @Column(nullable = false, length = 50)
    private String name;

    @Column(name = "display_order", nullable = false)
    private int displayOrder;

    /** JPA가 장르를 생성합니다. */
    protected Genre() { }

    /** 장르의 표시 이름을 반환합니다.
     * @return 장르의 표시 이름입니다. */
    public String getName() { return name; }
}
