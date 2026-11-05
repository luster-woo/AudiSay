package com.audisay.domain.chat.search;

/** float[] ↔ pgvector 글 형식("[0.1,0.2,...]") */
final class PgVectors {

    private PgVectors() {
    }

    static String literal(float[] vector) {
        StringBuilder text = new StringBuilder(vector.length * 10).append('[');
        for (int i = 0; i < vector.length; i++) {
            if (i > 0) {
                text.append(',');
            }
            text.append(vector[i]);
        }
        return text.append(']').toString();
    }
}
