package dev.permitflow.documents;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;

import dev.permitflow.applications.ApplicationService;
import io.minio.BucketExistsArgs;
import io.minio.GetObjectArgs;
import io.minio.MakeBucketArgs;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import io.minio.errors.ErrorResponseException;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ContentDisposition;
import org.springframework.http.ResponseEntity;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/applications/{applicationId}/documents")
@SecurityRequirement(name = "demoBasic")
public class DocumentController {
    private static final String BUCKET = "permitflow-demo-documents";
    private static final String FIELDS = "id, filename, media_type, bytes";

    @Schema(requiredProperties = {"id", "filename", "mediaType", "bytes"})
    public record Metadata(UUID id, String filename, String mediaType, int bytes) {}

    private final JdbcClient db;
    private final ApplicationService applications;
    private final MinioClient storage;

    public DocumentController(JdbcClient db, ApplicationService applications,
                              @Value("${permitflow.minio.url}") String url,
                              @Value("${permitflow.minio.access-key}") String accessKey,
                              @Value("${permitflow.minio.secret-key}") String secretKey) {
        this.db = db;
        this.applications = applications;
        this.storage = MinioClient.builder().endpoint(url).credentials(accessKey, secretKey).build();
        storage.setTimeout(2000, 5000, 5000);
    }

    @GetMapping
    public List<Metadata> list(Authentication actor, @PathVariable UUID applicationId) {
        applications.detail(actor, applicationId);
        return db.sql("SELECT " + FIELDS + " FROM application_documents WHERE application_id = :id AND ready ORDER BY id")
                .param("id", applicationId).query(Metadata.class).list();
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasRole('APPLICANT')")
    public Metadata upload(Authentication actor, @PathVariable UUID applicationId,
                           @RequestHeader("X-PermitFlow-Demo") String demoHeader,
                           @RequestParam("file") MultipartFile file) throws Exception {
        applications.detail(actor, applicationId);
        String filename = file.getOriginalFilename();
        if (filename == null || !filename.matches("demo-[a-z0-9-]{1,48}\\.txt")
                || !MediaType.TEXT_PLAIN_VALUE.equals(file.getContentType())
                || file.isEmpty() || file.getSize() > 256) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_DEMO_DOCUMENT");
        }
        byte[] bytes = file.getBytes();
        if (!new String(bytes, StandardCharsets.US_ASCII).matches("PERMITFLOW-DEMO-[0-9]{1,12}\\r?\\n?")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_DEMO_DOCUMENT");
        }
        String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        db.sql("""
                INSERT INTO application_documents (id, application_id, sha256, filename, media_type, bytes)
                VALUES (:id, :application, :hash, :filename, 'text/plain', :bytes)
                ON CONFLICT (application_id, sha256) DO NOTHING
                """).param("id", UUID.randomUUID()).param("application", applicationId).param("hash", hash)
                .param("filename", filename).param("bytes", bytes.length).update();
        Metadata metadata = db.sql("SELECT " + FIELDS + """
                 FROM application_documents WHERE application_id = :application AND sha256 = :hash
                """).param("application", applicationId).param("hash", hash).query(Metadata.class).single();
        try {
            ensureBucket();
            storage.putObject(PutObjectArgs.builder().bucket(BUCKET)
                    .object(applicationId + "/" + metadata.id()).contentType(MediaType.TEXT_PLAIN_VALUE)
                    .stream(new ByteArrayInputStream(bytes), bytes.length, -1).build());
        } catch (Exception unavailable) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "DOCUMENT_STORAGE_UNAVAILABLE", unavailable);
        }
        db.sql("UPDATE application_documents SET ready = true WHERE id = :id")
                .param("id", metadata.id()).update();
        return metadata;
    }

    @GetMapping("/{documentId}")
    public ResponseEntity<byte[]> download(Authentication actor, @PathVariable UUID applicationId,
                                            @PathVariable UUID documentId) {
        applications.detail(actor, applicationId);
        Metadata metadata = db.sql("SELECT " + FIELDS + """
                 FROM application_documents WHERE application_id = :application AND id = :document AND ready
                """).param("application", applicationId).param("document", documentId)
                .query(Metadata.class).optional().orElseThrow(() ->
                        new ResponseStatusException(HttpStatus.NOT_FOUND, "DOCUMENT_NOT_FOUND"));
        try (var object = storage.getObject(GetObjectArgs.builder().bucket(BUCKET)
                .object(applicationId + "/" + documentId).build())) {
            return ResponseEntity.ok().contentType(MediaType.TEXT_PLAIN)
                    .headers(headers -> headers.setContentDisposition(
                            ContentDisposition.attachment().filename(metadata.filename()).build()))
                    .body(object.readNBytes(metadata.bytes()));
        } catch (Exception unavailable) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "DOCUMENT_STORAGE_UNAVAILABLE", unavailable);
        }
    }

    private void ensureBucket() throws Exception {
        if (!storage.bucketExists(BucketExistsArgs.builder().bucket(BUCKET).build())) {
            try {
                storage.makeBucket(MakeBucketArgs.builder().bucket(BUCKET).build());
            } catch (ErrorResponseException error) {
                if (!"BucketAlreadyOwnedByYou".equals(error.errorResponse().code())) {
                    throw error;
                }
            }
        }
    }
}
