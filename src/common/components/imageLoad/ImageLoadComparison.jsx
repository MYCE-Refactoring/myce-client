import { useState, useEffect } from 'react';

const ImageLoadComparison = ({ src, alt, className, style, ...props }) => {
  const [imageLoadTime, setImageLoadTime] = useState(null);
  const [imageSrc, setImageSrc] = useState(src);
  const [isS3Image, setIsS3Image] = useState(false);

  useEffect(() => {
    // S3 이미지인지 MongoDB 이미지인지 확인
    const isS3 = src && (src.includes('cloudfront') || src.includes('amazonaws.com') || src.includes('s3'));
    const isMongo = src && src.includes('/api/images/mongo/');
    setIsS3Image(isS3);
    setImageSrc(src);

    if (src) {
      const startTime = performance.now();
      
      // 새 이미지 객체 생성하여 로딩 시간 측정
      const img = new Image();
      
      img.onload = () => {
        const endTime = performance.now();
        const loadTime = endTime - startTime;
        setImageLoadTime(loadTime);

        // 성능 데이터 저장
        const performanceData = {
          method: isS3 ? 's3' : (isMongo ? 'mongodb' : 'local'),
          imageUrl: src,
          loadTime: loadTime,
          timestamp: new Date().toISOString(),
          imageSize: {
            width: img.naturalWidth,
            height: img.naturalHeight
          }
        };

        // localStorage에 성능 데이터 저장
        const existingData = JSON.parse(localStorage.getItem('imageLoadPerformance') || '[]');
        localStorage.setItem('imageLoadPerformance', JSON.stringify([...existingData, performanceData]));

        const sourceType = isS3 ? 'S3/CDN' : (isMongo ? 'MongoDB' : '로컬');
        console.log(`🖼️ [${sourceType}] 이미지 로딩 완료: ${loadTime.toFixed(2)}ms`, {
          url: src,
          size: `${img.naturalWidth}x${img.naturalHeight}`,
          method: performanceData.method
        });
      };

      img.onerror = () => {
        console.error('이미지 로딩 실패:', src);
      };

      img.src = src;
    }
  }, [src]);

  // 성능 결과를 콘솔에 출력하는 함수 (개발 시 사용)
  const showImageLoadPerformance = () => {
    const allData = JSON.parse(localStorage.getItem('imageLoadPerformance') || '[]');
    console.table(allData);
    
    if (allData.length > 0) {
      const s3Results = allData.filter(d => d.method === 's3');
      const mongoResults = allData.filter(d => d.method === 'mongodb');
      
      if (s3Results.length > 0 && mongoResults.length > 0) {
        const s3Avg = s3Results.reduce((sum, r) => sum + r.loadTime, 0) / s3Results.length;
        const mongoAvg = mongoResults.reduce((sum, r) => sum + r.loadTime, 0) / mongoResults.length;
        
        console.log(`📊 이미지 로딩 성능 비교 결과:
S3/CDN 평균: ${s3Avg.toFixed(2)}ms (${s3Results.length}회)
MongoDB 평균: ${mongoAvg.toFixed(2)}ms (${mongoResults.length}회)
차이: ${Math.abs(s3Avg - mongoAvg).toFixed(2)}ms (${s3Avg > mongoAvg ? 'MongoDB가 빠름' : 'S3/CDN이 빠름'})`);
      }
    }
  };

  // 개발 환경에서만 더블클릭으로 성능 결과 보기
  const handleDoubleClick = () => {
    if (process.env.NODE_ENV === 'development') {
      showImageLoadPerformance();
    }
  };

  return (
    <img
      src={imageSrc}
      alt={alt}
      className={className}
      style={{
        ...style,
        // 로딩 성능 정보를 개발자 도구에서 확인할 수 있도록 data attribute 추가
        ...(imageLoadTime && {
          '--load-time': `${imageLoadTime.toFixed(2)}ms`,
          '--source-type': isS3Image ? 's3' : 'local'
        })
      }}
      onDoubleClick={handleDoubleClick}
      title={imageLoadTime ? `로딩 시간: ${imageLoadTime.toFixed(2)}ms (${isS3Image ? 'S3/CDN' : (src?.includes('/api/images/mongo/') ? 'MongoDB' : '로컬')})` : alt}
      {...props}
    />
  );
};

export default ImageLoadComparison;